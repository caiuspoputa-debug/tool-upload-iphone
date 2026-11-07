const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../docs/firebase-transport.js');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const base = 'accounts/owner/workspaces/main';
const validate = value => {
  if (!value || typeof value !== 'object' || !Array.isArray(value.clients) || !value.settings || typeof value.settings.label !== 'string') throw Error('Invalid business state');
  return copy(value);
};
const state = (label = 'Frizerie') => ({ clients: [], settings: { label } });
const doc = (genesis, device = 'android', operations = []) => ({ protocol: 'frizerie-drive-1', workspace: 'shared', device, genesis, operations });

class FakeFirestore {
  constructor() {
    this.data = new Map(); this.versions = new Map(); this.listeners = new Set(); this.reads = 0; this.writes = 0; this.deletes = 0; this.batches = []; this.fail = null;
  }
  doc(path) { return new FakeRef(this, path); }
  collection(path) { return new FakeCollection(this, path); }
  snapshot(ref, metadata = { fromCache: false, hasPendingWrites: false }) {
    const value = copy(this.data.get(ref.path));
    return { id: ref.id, ref, exists: value !== undefined, metadata, data: () => copy(value) };
  }
  query(ref, metadata = { fromCache: false, hasPendingWrites: false }) {
    const prefix = ref.path + '/', docs = [];
    for (const path of this.data.keys()) if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) docs.push(this.snapshot(this.doc(path), metadata));
    return { docs, metadata };
  }
  listen(ref, options, next, error) {
    assert.equal(options.includeMetadataChanges, true);
    const entry = { ref, next, error }; this.listeners.add(entry);
    queueMicrotask(() => { if (this.listeners.has(entry)) next(ref instanceof FakeCollection ? this.query(ref) : this.snapshot(ref)); });
    return () => this.listeners.delete(entry);
  }
  notify(metadata) {
    for (const entry of this.listeners) queueMicrotask(() => { if (this.listeners.has(entry)) entry.next(entry.ref instanceof FakeCollection ? this.query(entry.ref, metadata) : this.snapshot(entry.ref, metadata)); });
  }
  commit(operations) {
    const failure = this.fail && operations.some(operation => this.fail(operation));
    if (failure) throw Object.assign(Error('Simulated Firestore write failure'), { code: 'unavailable' });
    for (const operation of operations) {
      this.versions.set(operation.ref.path, (this.versions.get(operation.ref.path) || 0) + 1);
      if (operation.remove) { this.data.delete(operation.ref.path); this.deletes++; }
      else { this.data.set(operation.ref.path, copy(operation.value)); this.writes++; }
    }
    this.notify();
  }
  batch() {
    const operations = [];
    return {
      set: (ref, value) => operations.push({ ref, value }),
      delete: ref => operations.push({ ref, remove: true }),
      commit: async () => { this.batches.push(copy(operations.map(operation => ({ path: operation.ref.path, value: operation.value })))); this.commit(operations); }
    };
  }
  async runTransaction(fn) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const reads = new Map(), writes = []; let writing = false;
      const transaction = {
        get: async ref => { assert.equal(writing, false, 'Firestore transactions must read before writing'); this.reads++; reads.set(ref.path, this.versions.get(ref.path) || 0); return this.snapshot(ref); },
        set: (ref, value) => { writing = true; writes.push({ ref, value }); },
        delete: ref => { writing = true; writes.push({ ref, remove: true }); }
      };
      const result = await fn(transaction);
      if ([...reads].some(([path, version]) => (this.versions.get(path) || 0) !== version)) continue;
      this.commit(writes); return result;
    }
    throw Error('Transaction retry limit');
  }
}
class FakeRef {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').pop(); }
  async get(options) { assert.equal(options.source, 'server'); this.db.reads++; const snapshot = this.db.snapshot(this); if (this.db.onRead) await this.db.onRead(this); return snapshot; }
  async delete() { this.db.commit([{ ref: this, remove: true }]); }
  onSnapshot(...args) { return this.db.listen(this, ...args); }
}
class FakeCollection extends FakeRef {
  async get(options) { assert.equal(options.source, 'server'); this.db.reads++; const snapshot = this.db.query(this); if (this.db.onRead) await this.db.onRead(this); return snapshot; }
}
const transport = db => create({ db, uid: 'owner', validate });
const flush = () => new Promise(resolve => setImmediate(resolve));
const payloadPath = revision => base + '/payloads/' + revision;

test('bootstrap races choose exactly one immutable root and genesis', async () => {
  const db = new FakeFirestore(), a = transport(db), b = transport(db);
  const [first, second] = await Promise.all([a.bootstrap(state('A'), 'a-workspace'), b.bootstrap(state('B'), 'b-workspace')]);
  assert.deepEqual(first, second);
  assert(['A', 'B'].includes(first.genesis.settings.label));
  assert.equal(db.data.get(base).genesisRevision, first.genesisRevision);
  const published = [...db.data.keys()].filter(path => /^accounts\/owner\/workspaces\/main\/payloads\/[a-f0-9]{64}$/.test(path));
  assert.equal(published.length, 1, 'A losing bootstrap retires only its own unpublished payload');
  assert.deepEqual(await transport(db).workspace(), first);
});

test('bootstrap tolerates one missing root read after a successful root transaction', async () => {
  const db = new FakeFirestore(), originalSnapshot = db.snapshot.bind(db), initial = state('Full iPhone agenda');
  let missed = false;
  db.snapshot = (reference, metadata) => {
    if (reference.path === base && db.data.has(base) && !missed) {
      missed = true;
      return { id: reference.id, ref: reference, exists: false, metadata: { fromCache: false, hasPendingWrites: false }, data: () => undefined };
    }
    return originalSnapshot(reference, metadata);
  };
  const channel = transport(db), result = await channel.bootstrap(initial, 'iphone-workspace');
  assert.equal(missed, true, 'the simulated server read missed the root only after it had actually committed');
  assert.equal(result.workspace, 'iphone-workspace');
  assert.deepEqual(result.genesis, initial);
  assert.equal(db.data.get(base).genesisRevision, result.genesisRevision);
  assert.deepEqual((await transport(db).workspace()).genesis, initial);
  const payloads = [...db.data.keys()].filter(path => /^accounts\/owner\/workspaces\/main\/payloads\/[a-f0-9]{64}$/.test(path));
  assert.equal(payloads.length, 1, 'the confirmed genesis is never retired on a transient verification miss');
});

test('a still-unconfirmed bootstrap fails safely and retry reuses its existing root without replacing the agenda', async () => {
  const db = new FakeFirestore(), originalSnapshot = db.snapshot.bind(db), initial = state('Preserve every iPhone appointment');
  let hideCommittedRoot = true;
  db.snapshot = (reference, metadata) => {
    if (reference.path === base && db.data.has(base) && hideCommittedRoot) return { id: reference.id, ref: reference, exists: false, metadata: { fromCache: false, hasPendingWrites: false }, data: () => undefined };
    return originalSnapshot(reference, metadata);
  };
  await assert.rejects(transport(db).bootstrap(initial, 'original-workspace'), error => !(error instanceof TypeError) && typeof error.message === 'string' && error.message.length > 0, 'an unconfirmed root must produce a controlled error, never dereference null');
  const committedRoot = copy(db.data.get(base)), writes = db.writes;
  assert.ok(committedRoot?.genesisRevision);
  assert.equal(db.data.has(payloadPath(committedRoot.genesisRevision)), true, 'the committed business snapshot remains intact after the controlled error');
  hideCommittedRoot = false;
  const recovered = await transport(db).bootstrap(state('Do not replace existing records'), 'replacement-not-authorized');
  assert.deepEqual(recovered.genesis, initial);
  assert.equal(recovered.workspace, 'original-workspace');
  assert.deepEqual(db.data.get(base), committedRoot);
  assert.equal(db.writes, writes, 'retry reads the already-existing workspace without uploading replacement data');
});

test('journal roundtrip shares genesis, chunks Unicode, deduplicates writes and retires old revisions', async () => {
  const db = new FakeFirestore(), a = transport(db), genesis = state('Frizerie ' + 'ț💈'.repeat(60000));
  await a.bootstrap(genesis, 'shared');
  const initial = doc(genesis), uploaded = await a.upload(initial);
  assert.notEqual(uploaded.revision, db.data.get(base + '/journals/android').sha256, 'Revision identity is distinct from checksum');
  const writes = db.writes, repeated = await a.upload(initial);
  assert.deepEqual(repeated, uploaded); assert.equal(db.writes, writes, 'An unchanged head does not rewrite any payload');
  const other = transport(db), journals = await other.list();
  assert.deepEqual(journals, [{ ...uploaded, doc: initial }]);
  assert.deepEqual((await other.workspace()).genesis, genesis);
  const op = { id: 'change-one', device: 'android', parents: [], changes: [{ key: 'clients/c1', before: null, after: { id: 'c1', name: 'Ion' } }] };
  const next = await a.upload(doc(genesis, 'android', [op]), uploaded.revision);
  assert.notEqual(next.revision, uploaded.revision);
  assert.equal(db.data.has(payloadPath(uploaded.revision)), false, 'Only the replaced journal payload is retired');
  assert.equal(db.data.has(payloadPath(db.data.get(base).genesisRevision)), true, 'Shared genesis is never retired');
  assert.deepEqual((await transport(db).list())[0].doc.operations, [op]);
  for (const batch of db.batches) {
    assert(batch.length <= 12);
    for (const item of batch) if (item.value?.payload) {
      assert(Buffer.byteLength(item.value.payload, 'utf8') <= 204800);
      assert.match(item.path.split('/').pop(), /^\d{4}$/);
    }
    assert(Buffer.byteLength(JSON.stringify(batch), 'utf8') < 10 * 1024 * 1024);
  }
});

test('journal CAS rejects stale changes and failed chunk upload cannot replace a published head', async () => {
  const db = new FakeFirestore(), a = transport(db), genesis = state(); await a.bootstrap(genesis, 'shared');
  const first = await a.upload(doc(genesis)), before = copy(db.data.get(base + '/journals/android'));
  await assert.rejects(a.upload(doc(genesis, 'android', [{ id: 'stale' }]), null), { code: 'remote_changed' });
  assert.deepEqual(db.data.get(base + '/journals/android'), before);
  db.fail = operation => !operation.remove && operation.ref.path.includes('/chunks/');
  await assert.rejects(a.upload(doc(genesis, 'android', [{ id: 'new' }]), first.revision), /Simulated/);
  assert.deepEqual(db.data.get(base + '/journals/android'), before);
  assert(db.data.has(payloadPath(first.revision)));
  db.fail = null;
  assert.deepEqual((await transport(db).list())[0].doc, doc(genesis));
});

test('checksum mismatch and incomplete revision fail before returning remote business data', async () => {
  const db = new FakeFirestore(), a = transport(db), genesis = state(); await a.bootstrap(genesis, 'shared');
  const uploaded = await a.upload(doc(genesis));
  const chunk = payloadPath(uploaded.revision) + '/chunks/0000', saved = copy(db.data.get(chunk));
  db.data.set(chunk, { ...saved, payload: Buffer.from('tampered body').toString('base64') });
  await assert.rejects(transport(db).list(), { code: 'invalid_remote' });
  db.data.delete(chunk);
  await assert.rejects(transport(db).list(), { code: 'missing_revision' });
  db.data.set(chunk, saved);
  assert.deepEqual((await transport(db).list())[0].doc, doc(genesis));
});

test('confirmed subscriptions ignore cache, pending writes, unchanged metadata and unsubscribe cleanly', async () => {
  const db = new FakeFirestore(), a = transport(db), events = [], errors = [];
  const unsubscribe = a.subscribe(value => events.push(value.kind), error => errors.push(error));
  await flush(); assert.deepEqual(events.sort(), ['journals', 'workspace']); events.length = 0;
  db.notify({ fromCache: true, hasPendingWrites: false });
  db.notify({ fromCache: false, hasPendingWrites: true }); await flush(); assert.deepEqual(events, []);
  await a.bootstrap(state(), 'shared'); await flush(); assert.deepEqual(events, ['workspace']); events.length = 0;
  await a.upload(doc(state())); await flush(); assert.deepEqual(events, ['journals']); events.length = 0;
  db.notify({ fromCache: false, hasPendingWrites: false }); await flush(); assert.deepEqual(events, []);
  unsubscribe(); db.notify(); await flush(); assert.deepEqual(events, []); assert.equal(db.listeners.size, 0); assert.deepEqual(errors, []);
  a.close(); await assert.rejects(a.workspace(), { code: 'disconnected' });
});

test('backup CAS, same-day replacement, validated restore and failed publication preserve the previous backup', async () => {
  const db = new FakeFirestore(), a = transport(db), genesis = state(); await a.bootstrap(genesis, 'shared');
  assert.deepEqual(await a.backupStatus(), { hasBackup: false, revision: null, modifiedAt: null });
  const first = await a.backup(state('first'), 'android', null), writes = db.writes;
  assert.equal((await a.backupStatus()).revision, first.revision);
  assert.deepEqual((await transport(db).restore()).state, state('first'));
  assert.equal((await a.backup(state('first'), 'android', null)).revision, first.revision);
  assert.equal(db.writes, writes, 'Identical current backup has no writes');
  await assert.rejects(a.backup(state('stale'), 'iphone', null), { code: 'remote_changed' });
  db.fail = operation => operation.ref.path === base + '/backupState/current';
  await assert.rejects(a.backup(state('failed'), 'android', first.revision), /Simulated/);
  assert.equal((await a.backupStatus()).revision, first.revision);
  assert(db.data.has(payloadPath(first.revision)));
  db.fail = null;
  const second = await a.backup(state('second'), 'android', first.revision);
  assert.notEqual(second.revision, first.revision);
  assert.equal(db.data.has(payloadPath(first.revision)), false);
  assert.deepEqual((await transport(db).restore()).state, state('second'));
  await assert.rejects(a.backup({ clients: [] }, 'android', second.revision), /Invalid business state/);
});

test('daily retention keeps seven manifests and retires only their private payloads after a successful new backup', async () => {
  const db = new FakeFirestore(), a = transport(db); await a.bootstrap(state(), 'shared');
  const actualNow = Date.now; let previous = null;
  try {
    for (let day = 1; day <= 9; day++) {
      Date.now = () => new Date(2026, 10, day, 12, 0, 0).getTime();
      previous = (await a.backup(state('day ' + day), 'android', previous)).revision;
    }
  } finally { Date.now = actualNow; }
  const days = [...db.data.keys()].filter(path => path.startsWith(base + '/backups/')).sort();
  assert.equal(days.length, 7); assert(days[0].endsWith('2026-11-03')); assert(days[6].endsWith('2026-11-09'));
  const manifests = [...db.data.keys()].filter(path => /^accounts\/owner\/workspaces\/main\/payloads\/[a-f0-9]{64}$/.test(path));
  assert.equal(manifests.length, 8, 'Seven backups plus immutable genesis remain');
  assert.deepEqual((await transport(db).restore()).state, state('day 9'));
  const history = await a.listBackups();
  assert.equal(history.length, 7);
  assert.deepEqual(history.map(item => item.day), ['2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03']);
  assert(history.every(item => item.sourceDevice === 'android' && item.modifiedAt.endsWith('Z')));
  assert.deepEqual((await transport(db).restore(history.at(-1).revision)).state, state('day 3'));
});

test('owner paths are isolated and mismatched workspace or genesis cannot be uploaded', async () => {
  const db = new FakeFirestore(), a = transport(db); await a.bootstrap(state(), 'shared');
  const other = create({ db, uid: 'other-owner', validate }); assert.equal(await other.workspace(), null);
  await assert.rejects(a.upload({ ...doc(state()), workspace: 'different' }), { code: 'invalid_remote' });
  await assert.rejects(a.upload(doc(state('different genesis'))), { code: 'workspace_mismatch' });
  assert.throws(() => create({ db, uid: '../owner', validate }), /incompletă/);
});

test('concurrent same-device publication has one CAS winner and removes only the losing private stage', async () => {
  const db = new FakeFirestore(), a = transport(db), b = transport(db); await a.bootstrap(state(), 'shared');
  const first = await a.upload(doc(state()));
  const outcomes = await Promise.allSettled([
    a.upload(doc(state(), 'android', [{ id: 'A' }]), first.revision),
    b.upload(doc(state(), 'android', [{ id: 'B' }]), first.revision)
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(item => item.status === 'rejected').reason.code, 'remote_changed');
  const payloads = [...db.data.keys()].filter(path => /^accounts\/owner\/workspaces\/main\/payloads\/[a-f0-9]{64}$/.test(path));
  assert.equal(payloads.length, 2, 'Only root genesis and the winning journal remain');
  assert.equal((await transport(db).list())[0].doc.operations.length, 1);
});

test('a reader retries a retired journal snapshot and the latest backup pointer without returning partial data', async () => {
  const db = new FakeFirestore(), a = transport(db); await a.bootstrap(state(), 'shared');
  const first = await a.upload(doc(state()));
  db.onRead = async reference => {
    if (reference.path !== base + '/journals') return;
    db.onRead = null; await a.upload(doc(state(), 'android', [{ id: 'after-snapshot' }]), first.revision);
  };
  assert.deepEqual((await transport(db).list())[0].doc.operations, [{ id: 'after-snapshot' }]);
  const backup = await a.backup(state('before-snapshot'), 'android');
  db.onRead = async reference => {
    if (reference.path !== base + '/backupState/current') return;
    db.onRead = null; await a.backup(state('after-snapshot'), 'android', backup.revision);
  };
  assert.deepEqual((await transport(db).restore()).state, state('after-snapshot'));
});

test('head checksum mismatches are rejected and cleanup failures never invalidate a successful replacement', async () => {
  const db = new FakeFirestore(), a = transport(db); await a.bootstrap(state(), 'shared');
  const first = await a.upload(doc(state())), headPath = base + '/journals/android', original = copy(db.data.get(headPath));
  db.data.set(headPath, { ...original, sha256: '0'.repeat(64) });
  await assert.rejects(transport(db).list(), { code: 'invalid_remote' }); db.data.set(headPath, original);
  db.fail = operation => operation.remove;
  const next = await a.upload(doc(state(), 'android', [{ id: 'new' }]), first.revision);
  assert.equal(db.data.get(headPath).revision, next.revision);
  assert.equal(a.maintenancePending(), true);
  assert.deepEqual((await transport(db).list())[0].doc.operations, [{ id: 'new' }]);
  assert(db.data.has(payloadPath(first.revision)), 'A failed cleanup retains old data instead of risking the new pointer');
});

test('backup history rejects malformed or mismatched manifests and oversized payload metadata', async () => {
  const db = new FakeFirestore(), a = transport(db); await a.bootstrap(state(), 'shared');
  const backup = await a.backup(state('backup'), 'android'), path = base + '/backups/' + backup.day, original = copy(db.data.get(path));
  db.data.set(path, { ...original, workspace: 'another-workspace' });
  await assert.rejects(a.listBackups(), { code: 'invalid_remote' });
  db.data.set(path, { ...original, bytes: 30 * 1024 * 1024 + 1 });
  await assert.rejects(a.listBackups(), { code: 'invalid_remote' });
  db.data.set(path, original);
  const rootPayloadPath = payloadPath(db.data.get(base).genesisRevision), rootManifest = copy(db.data.get(rootPayloadPath));
  db.data.set(rootPayloadPath, { ...rootManifest, bytes: 30 * 1024 * 1024 + 1 });
  await assert.rejects(transport(db).workspace(), { code: 'invalid_remote' });
});

test('decoded payload LRU evicts old bodies while verified journals remain readable', async () => {
  const db = new FakeFirestore(), a = transport(db); await a.bootstrap(state(), 'shared');
  const first = await a.upload(doc(state(), 'device-0'));
  for (let index = 1; index <= 65; index++) await a.upload(doc(state(), 'device-' + index));
  let refetched = 0;
  db.onRead = async reference => { if (reference.path === payloadPath(first.revision)) refetched++; };
  const journals = await a.list();
  assert.equal(journals.length, 66);
  assert.equal(journals.find(item => item.fileId === 'device-0').revision, first.revision);
  assert(refetched >= 1, 'The oldest decoded body is loaded again after exceeding the 64-body cache');
});
