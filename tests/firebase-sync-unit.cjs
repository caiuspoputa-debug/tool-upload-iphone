'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const C = require('../docs/sync.js');
const J = require('../docs/drive-journal.js');
const clone = value => JSON.parse(JSON.stringify(value));

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.value = ''; this.isConnected = true; }
  append(...children) {
    this.children.push(...children);
    if (this.tag === 'select' && !this.value) this.value = this.children.find(child => child.tag === 'option')?.value || '';
  }
  replaceChildren(...children) { this.children = []; if (this.tag === 'select') this.value = ''; this.append(...children); }
  setAttribute(name, value) { this[name] = value; }
}
const walk = root => [root, ...(root.children || []).flatMap(child => typeof child === 'object' ? walk(child) : [])];
const baseState = () => ({ version: 1, demo: false, settings: {}, clients: [], appointments: [], expenses: [], suppliers: [], services: [{ id: 'cut', name: 'Tuns', price: 10 }] });

function harness(options = {}) {
  const initial = baseState(), device = 'android-test', workspace = 'workspace-test';
  const initialDoc = { protocol: 'frizerie-drive-1', workspace, device, genesis: clone(initial), operations: [] };
  let state = clone(options.state || initial), metadata = options.metadata || {
    kind: 'frizerie-firebase-local', device, firebaseUid: 'owner-test', firebaseRevision: 'revision-0',
    doc: clone(initialDoc), others: [], backup: { auto: false, pending: false, lastHash: null, lastBackup: null }
  };
  let durable = { state: clone(state), device: clone(metadata) }, failSave = false, online = true, formOpen = false;
  let cloudDoc = clone(initialDoc), revision = 'revision-0', backupCompleted = false, hashInjected = false;
  const calls = { uploads: [], backups: [], restores: [], exports: [], commits: [], events: [], confirmations: [], auth: [], transports: [], closed: 0, unsubscribed: 0 };
  let signedIn = options.user === undefined ? { uid: 'owner-test', email: 'macsocietysrl@gmail.com', emailVerified: true } : options.user;
  const timers = new Map(); let timerId = 0;
  const target = new EventTarget();
  const document = { hidden: false, createElement: tag => new Element(tag), createTextNode: text => text, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  let manager;
  const commit = async price => {
    const next = clone(state); next.services[0].price = price;
    const ok = await manager.save(next);
    if (ok) { state = clone(next); calls.commits.push(price); }
    return ok;
  };
  const channel = {
    workspace: async () => ({ workspace, genesis: clone(initial) }),
    list: async () => [{ revision, doc: clone(cloudDoc) }],
    upload: async value => { calls.uploads.push(clone(value)); cloudDoc = clone(value); revision = `revision-${calls.uploads.length}`; return { revision }; },
    subscribe: () => () => { calls.unsubscribed++; }, close() { calls.closed++; },
    backupStatus: async () => { if (options.editDuringStatus) await commit(20); return { revision: 'old-backup' }; },
    backup: async snapshot => {
      calls.backups.push(clone(snapshot));
      if (options.editDuringSend) await commit(30);
      backupCompleted = true;
      return { revision: 'new-backup', modifiedAt: '2026-11-03T10:00:00.000Z' };
    },
    listBackups: async () => [{ revision: 'new-backup', day: '2026-11-03', modifiedAt: '2026-11-03T10:00:00.000Z' }],
    restore: async () => { if (options.openFormDuringRestore) formOpen = true; return { state: clone(initial) }; }
  };
  const sandbox = {
    document, Event, TextEncoder, SalonSyncCore: C, SalonDriveJournal: J,
    crypto: {
      randomUUID: () => webcrypto.randomUUID(),
      subtle: { digest: async (...args) => {
        const result = await webcrypto.subtle.digest(...args);
        // A storage edit may complete during any asynchronous hash used by an
        // acknowledgement. It must not be paired with an older device journal.
        if (options.editDuringAckHash && backupCompleted && !hashInjected) { hashInjected = true; await commit(40); }
        return result;
      } }
    },
    Android: {
      loadDevice: () => JSON.stringify(durable.device),
      saveLocal: (next, proposal) => { if (failSave) return false; durable = { state: JSON.parse(next), device: JSON.parse(proposal) }; return true; }
    },
    SalonFirebaseConfig: { expectedEmail: 'macsocietysrl@gmail.com' },
    SalonFirebase: { configured: () => true, connected: () => !!signedIn && signedIn.emailVerified !== false, online: () => online, user: () => signedIn, db: () => ({}), isBusy: () => false, error: () => '', ready: async () => true,
      signIn: async (email, password) => { calls.auth.push({ kind: 'signIn', email, password }); signedIn = { uid: 'new-salon', email, emailVerified: true }; sandbox.dispatchEvent(new Event('salon-firebase-changed')); },
      signUp: async (email, password) => { calls.auth.push({ kind: 'signUp', email, password }); signedIn = { uid: 'new-salon', email, emailVerified: false }; sandbox.dispatchEvent(new Event('salon-firebase-changed')); },
      resetPassword: async email => { calls.auth.push({ kind: 'reset', email }); }, signOut: async () => { signedIn = null; sandbox.dispatchEvent(new Event('salon-firebase-changed')); }
    },
    SalonFirebaseTransport: { create: value => { calls.transports.push(value.uid); return channel; } }, confirm: message => { calls.confirmations.push(message); return true; },
    restoreBackup: raw => { calls.restores.push(JSON.parse(raw)); return true; },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
    addEventListener: (...args) => target.addEventListener(...args),
    dispatchEvent: event => { calls.events.push(event.type); return target.dispatchEvent(event); }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/firebase-sync-ui.js'), 'utf8'), sandbox);
  manager = sandbox.SalonFirebaseSyncUI.create({ getState: () => state, validate: clone, setState: value => { state = clone(value); }, hasOpenForm: () => formOpen, refresh() {}, exportRaw: raw => calls.exports.push(JSON.parse(raw)) });
  const settings = manager.renderSettings();
  const button = text => { const item = walk(settings).find(element => element.tag === 'button' && element.textContent === text); assert.ok(item, `button ${text}`); return item; };
  return { manager, calls, commit, saveState: async next => { const ok = await manager.save(next); if (ok) state = clone(next); return ok; }, settings, button, timers, bundle: () => clone(durable), state: () => clone(state), fail: value => { failSave = value; }, online: value => { online = value; }, form: value => { formOpen = value; }, setUser: value => { signedIn = value; sandbox.dispatchEvent(new Event('salon-firebase-changed')); }, channel, sandbox, refresh: () => sandbox.dispatchEvent(new Event('salon-firebase-changed')) };
}

test('legacy Drive metadata and pre-migration business data survive an atomic save failure', async () => {
  const legacy = { kind: 'frizerie-drive-local', device: 'old-device', doc: { pending: 'legacy-data' }, customSetting: true };
  const h = harness({ metadata: legacy }); h.online(false); h.fail(true);
  assert.equal(await h.commit(20), false);
  assert.deepEqual(h.bundle().device, legacy);
  assert.equal(h.bundle().state.services[0].price, 10);
  h.fail(false); assert.equal(await h.commit(20), true);
  assert.deepEqual(h.bundle().device.legacyConfiguration, legacy);
  assert.equal(h.bundle().device.preMigrationBackup.services[0].price, 10);
  assert.equal(h.bundle().state.services[0].price, 20);
});

test('offline edits persist business data with their journal, and failed edits add no duplicate operation', async () => {
  const h = harness(); h.online(false); h.fail(true);
  assert.equal(await h.commit(20), false);
  assert.equal(h.bundle().device.doc.operations.length, 0);
  h.fail(false); assert.equal(await h.commit(20), true);
  const bundle = h.bundle();
  assert.equal(bundle.device.doc.operations.length, 1);
  assert.deepEqual(J.replay([bundle.device.doc], clone).state, bundle.state);
  assert.equal(bundle.device.backup.pending, true);
  assert.equal(h.calls.uploads.length, 0);
});

test('local edits during backup fetch/send/ack preserve every committed journal change', async () => {
  const h = harness({ editDuringStatus: true, editDuringSend: true, editDuringAckHash: true });
  await h.button('Fă backup Firebase acum').onclick();
  const bundle = h.bundle();
  assert.equal(h.calls.backups.length, 1);
  assert.equal(h.calls.backups[0].services[0].price, 10);
  assert.ok(h.calls.commits.includes(20) && h.calls.commits.includes(30));
  assert.equal(bundle.state.services[0].price, h.calls.commits.at(-1));
  assert.deepEqual(J.replay([bundle.device.doc, ...(bundle.device.others || [])], clone).state, bundle.state);
  assert.equal(bundle.device.doc.operations.length, h.calls.commits.length);
  assert.equal(bundle.device.backup.pending, true);
});

test('paused synchronization prevents publishing a stale manual Firebase backup', async () => {
  const h = harness();
  await h.button('Oprește sincronizarea').onclick();
  await h.button('Fă backup Firebase acum').onclick();
  assert.equal(h.calls.backups.length, 0);
  assert.equal(h.bundle().device.paused, true);
});

test('a form opened while restore downloads is preserved without showing replacement confirmation', async () => {
  const h = harness({ openFormDuringRestore: true });
  const select = walk(h.settings).find(element => element.tag === 'select'); select.value = 'chosen-backup'; select.onchange();
  await h.button('Restaurează backupul Firebase ales').onclick();
  assert.equal(h.calls.restores.length, 0);
  assert.equal(h.bundle().state.services[0].price, 10);
  assert.match(h.manager.status(), /Restaurarea a fost oprită/);
});

const hint = h => walk(h.settings).find(element => element['data-firebase-backup-hint'] === '');

test('an unjoined agenda explains why backup is disabled without creating a workspace or changing data', () => {
  const h = harness({ metadata: { kind: 'frizerie-firebase-local', device: 'new-phone', paused: false } });
  const before = h.bundle();
  assert.equal(h.button('Fă backup Firebase acum').disabled, true);
  assert.match(hint(h).textContent, /Conectează agenda Firebase.*primul backup/);
  assert.equal(hint(h).hidden, false);
  assert.deepEqual(h.bundle(), before);
  assert.equal(h.calls.uploads.length, 0);
  assert.equal(h.calls.backups.length, 0);
});

test('offline and missing-authentication hints track the existing backup-disabled conditions', () => {
  const h = harness(), before = h.bundle();
  assert.equal(hint(h).hidden, true);
  h.online(false); h.refresh();
  assert.equal(h.button('Fă backup Firebase acum').disabled, true);
  assert.match(hint(h).textContent, /necesită internet/);
  h.online(true); h.sandbox.SalonFirebase.connected = () => false; h.refresh();
  assert.equal(h.button('Fă backup Firebase acum').disabled, true);
  assert.match(hint(h).textContent, /Conectează și verifică/);
  assert.deepEqual(h.bundle(), before);
});

test('paused synchronization explains the required next action without changing manual-backup gating', async () => {
  const h = harness();
  await h.button('Oprește sincronizarea').onclick();
  assert.match(hint(h).textContent, /Reia sincronizarea/);
  // The existing control remains enabled here; backup() independently prevents
  // publishing while synchronization is paused. The hint does not bypass it.
  await h.button('Fă backup Firebase acum').onclick();
  assert.equal(h.calls.backups.length, 0);
  assert.equal(h.bundle().device.paused, true);
});

test('busy synchronization and account operations expose a temporary backup hint', async () => {
  const h = harness(), workspace = h.channel.workspace;
  let release;
  h.channel.workspace = () => new Promise(resolve => { release = resolve; });
  const pending = h.button('Sincronizează acum').onclick();
  assert.equal(h.button('Fă backup Firebase acum').disabled, true);
  assert.match(hint(h).textContent, /Așteaptă finalizarea operației/);
  release(await workspace()); await pending;
  assert.equal(hint(h).hidden, true);
  h.sandbox.SalonFirebase.isBusy = () => true; h.refresh();
  assert.match(hint(h).textContent, /Așteaptă finalizarea operației/);
  assert.equal(h.calls.backups.length, 0);
});

const unjoined = () => ({ kind: 'frizerie-firebase-local', device: 'android-test', paused: false, backup: { auto: false, pending: true } });

test('first bootstrap persists its intent before network and retains local edits made during creation', async () => {
  const h = harness({ metadata: unjoined() }); let root = null, entered, release;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  h.channel.workspace = async () => clone(root);
  h.channel.list = async () => [];
  h.channel.bootstrap = async (snapshot, proposed) => {
    const stored = h.bundle();
    assert.equal(stored.device.bootstrapIntent.uid, 'owner-test');
    assert.equal(stored.device.bootstrapIntent.workspace, proposed);
    assert.match(stored.device.bootstrapIntent.genesisHash, /^[a-f0-9]{64}$/);
    assert.equal(stored.state.services[0].price, 10);
    root = { workspace: proposed, genesis: clone(snapshot) }; entered(); await gate; return clone(root);
  };
  const pending = h.button('Conectează agenda Firebase').onclick(); await started;
  assert.equal(await h.commit(20), true); release(); await pending;
  const bundle = h.bundle();
  assert.equal(bundle.state.services[0].price, 20);
  assert.equal(bundle.device.doc.genesis.services[0].price, 10);
  assert.equal(bundle.device.doc.operations.length, 1);
  assert.deepEqual(J.replay([bundle.device.doc], clone).state, bundle.state);
  assert.equal(bundle.device.preMigrationBackup.services[0].price, 20);
  assert.equal(Object.hasOwn(bundle.device, 'bootstrapIntent'), false);
  assert.equal(h.calls.confirmations.length, 1, 'Own bootstrap continuation needs no foreign-agenda adoption prompt');
  assert.equal(h.calls.uploads.length, 1);
});

test('a restarted own bootstrap journals later local edits instead of adopting its older genesis', async () => {
  const first = harness({ metadata: unjoined() }); let root = null;
  first.channel.workspace = async () => clone(root); first.channel.list = async () => [];
  first.channel.bootstrap = async (snapshot, proposed) => { root = { workspace: proposed, genesis: clone(snapshot) }; throw Error('Simulated lost creation confirmation'); };
  await first.button('Conectează agenda Firebase').onclick();
  assert.equal(first.bundle().device.doc, undefined); assert.ok(first.bundle().device.bootstrapIntent);
  assert.equal(await first.commit(25), true);
  const saved = first.bundle(), resumed = harness({ metadata: saved.device, state: saved.state });
  resumed.channel.workspace = async () => clone(root); resumed.channel.list = async () => [];
  resumed.channel.bootstrap = async () => { throw Error('The confirmed existing root must not be recreated'); };
  await resumed.button('Conectează agenda Firebase').onclick();
  const bundle = resumed.bundle();
  assert.equal(bundle.state.services[0].price, 25);
  assert.equal(bundle.device.doc.genesis.services[0].price, 10);
  assert.equal(bundle.device.doc.operations.length, 1);
  assert.deepEqual(J.replay([bundle.device.doc], clone).state, bundle.state);
  assert.equal(Object.hasOwn(bundle.device, 'bootstrapIntent'), false);
  assert.equal(resumed.calls.confirmations.length, 0, 'Durable own intent recognizes the retry without guessing ownership');
});

test('unknown partial cloud workspace requires explicit replacement approval and cancellation keeps current data', async () => {
  const current = baseState(); current.services[0].price = 40;
  const h = harness({ metadata: unjoined(), state: current }), before = h.bundle(); h.channel.list = async () => [];
  let prompt = '';
  h.sandbox.confirm = message => { prompt = message; return false; };
  await h.button('Conectează agenda Firebase').onclick();
  assert.match(prompt, /înlocuiești agenda activă/);
  assert.match(prompt, /Cloud:.*Local:/);
  assert.match(prompt, /doar agenda inițială, fără jurnale/);
  assert.deepEqual(h.bundle(), before);
  assert.equal(h.calls.uploads.length, 0);
});

test('foreign workspace winning the creation race is never adopted automatically', async () => {
  const h = harness({ metadata: unjoined() }); let workspaceCalls = 0, bootstrapCalls = 0;
  h.channel.workspace = async () => { workspaceCalls++; return null; };
  h.channel.list = async () => [];
  h.channel.bootstrap = async () => { bootstrapCalls++; return { workspace: 'foreign-winner', genesis: baseState() }; };
  const prompts = [];
  h.sandbox.confirm = message => { prompts.push(message); return prompts.length === 1; };
  await h.button('Conectează agenda Firebase').onclick();
  assert.equal(workspaceCalls, 1); assert.equal(bootstrapCalls, 1);
  assert.equal(prompts.length, 2); assert.match(prompts[1], /înlocuiești agenda activă/);
  assert.equal(h.bundle().device.doc, undefined);
  assert.equal(h.bundle().state.services[0].price, 10);
  assert.equal(h.calls.uploads.length, 0);
});

test('failed local intent persistence stops bootstrap before any cloud create or local replacement', async () => {
  const h = harness({ metadata: unjoined() }), before = h.bundle(); let calls = 0;
  h.channel.workspace = async () => null;
  h.channel.bootstrap = async () => { calls++; throw Error('Must not create without durable intent'); };
  h.fail(true); await h.button('Conectează agenda Firebase').onclick();
  assert.equal(calls, 0); assert.deepEqual(h.bundle(), before);
  assert.match(h.manager.status(), /Pregătirea agendei Firebase nu a putut fi salvată local/);
  assert.equal(h.calls.uploads.length, 0);
});

test('a pending owned workspace keeps local service ordering across creation', async () => {
  const h = harness({ metadata: unjoined() }); let root = null, entered, release;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  h.channel.workspace = async () => clone(root); h.channel.list = async () => [];
  h.channel.bootstrap = async (snapshot, proposed) => { root = { workspace: proposed, genesis: clone(snapshot) }; entered(); await gate; return clone(root); };
  const pending = h.button('Conectează agenda Firebase').onclick(); await started;
  const next = h.state(); next.services.unshift({ id: 'shave', name: 'Bărbierit', price: 15 });
  assert.equal(await h.saveState(next), true); release(); await pending;
  assert.deepEqual(h.state().services.map(service => service.id), ['shave', 'cut']);
  assert.deepEqual(h.bundle().device.preMigrationBackup.services.map(service => service.id), ['shave', 'cut']);
});

test('bootstrap intent survives a failed local join commit and is cleared only by its successful retry', async () => {
  const h = harness({ metadata: unjoined() }); let root = null;
  h.channel.workspace = async () => clone(root); h.channel.list = async () => [];
  h.channel.bootstrap = async (snapshot, proposed) => { root = { workspace: proposed, genesis: clone(snapshot) }; h.fail(true); return clone(root); };
  await h.button('Conectează agenda Firebase').onclick();
  assert.ok(h.bundle().device.bootstrapIntent); assert.equal(h.bundle().device.doc, undefined);
  assert.equal(h.calls.uploads.length, 0);
  h.fail(false); assert.equal(await h.commit(35), true);
  await h.button('Conectează agenda Firebase').onclick();
  assert.equal(h.bundle().state.services[0].price, 35);
  assert.equal(Object.hasOwn(h.bundle().device, 'bootstrapIntent'), false);
  assert.deepEqual(J.replay([h.bundle().device.doc], clone).state, h.bundle().state);
  assert.equal(h.calls.uploads.length, 1);
});

test('UID, workspace and genesis-hash mismatches never qualify an intent for automatic adoption', async () => {
  const origin = harness({ metadata: unjoined() }); let root = null;
  origin.channel.workspace = async () => null;
  origin.channel.bootstrap = async (snapshot, proposed) => { root = { workspace: proposed, genesis: clone(snapshot) }; throw Error('Simulated interrupted bootstrap'); };
  await origin.button('Conectează agenda Firebase').onclick();
  const saved = origin.bundle(); saved.state.services[0].price = 45;
  for (const [field, value] of [['uid', 'another-owner'], ['workspace', 'different-workspace'], ['genesisHash', '0'.repeat(64)]]) {
    const altered = clone(saved.device); altered.bootstrapIntent[field] = value;
    const h = harness({ metadata: altered, state: saved.state }); h.channel.workspace = async () => clone(root); h.channel.list = async () => [];
    let prompts = 0; h.sandbox.confirm = () => { prompts++; return false; };
    await h.button('Conectează agenda Firebase').onclick();
    assert.equal(prompts, field === 'uid' ? 0 : 1, field + ' mismatch must never adopt automatically');
    if (field === 'uid') assert.match(h.manager.status(), /altui cont/);
    assert.equal(h.bundle().state.services[0].price, 45); assert.equal(h.bundle().device.doc, undefined); assert.equal(h.calls.uploads.length, 0);
  }
});

const input = (root, label) => walk(root).find(element => element.tag === 'input' && element['aria-label'] === label);
const historySelect = root => walk(root).find(element => element.tag === 'select');
const otherUser = { uid: 'another-salon', email: 'another.salon@example.test', emailVerified: true };
const ownerUser = { uid: 'owner-test', email: 'macsocietysrl@gmail.com', emailVerified: true };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('editable email and password drafts survive UI refresh/rebuild but never enter durable business storage', async () => {
  const h = harness({ user: null, metadata: unjoined() }), before = h.bundle();
  const email = input(h.settings, 'E-mail cont aplicație'), password = input(h.settings, 'Parola contului aplicației');
  assert.equal(email.value, ''); assert.equal(email.readOnly, false);
  email.value = 'new.salon@example.test'; email.oninput(); password.value = 'synthetic-private-password'; password.oninput();
  h.refresh(); const rebuilt = h.manager.renderSettings();
  assert.equal(input(rebuilt, 'E-mail cont aplicație').value, 'new.salon@example.test');
  assert.equal(input(rebuilt, 'Parola contului aplicației').value, 'synthetic-private-password');
  assert.deepEqual(h.bundle(), before);
  await h.button('Creează contul aplicației').onclick();
  assert.deepEqual(h.calls.auth, [{ kind: 'signUp', email: 'new.salon@example.test', password: 'synthetic-private-password' }]);
  assert.equal(input(h.manager.renderSettings(), 'Parola contului aplicației').value, '');
  assert(!JSON.stringify(h.bundle()).includes('synthetic-private-password'));
  assert.equal(h.calls.uploads.length, 0, 'An unverified sign-up cannot create or join a workspace');
  assert(walk(h.manager.renderSettings()).some(element => element.textContent === 'new.salon@example.test'));
});

test('password reset uses the editable email and clearing the email remains a draft across refresh', async () => {
  const h = harness({ user: null, metadata: unjoined() }), email = input(h.settings, 'E-mail cont aplicație');
  email.value = 'reset.salon@example.test'; email.oninput(); await h.button('Am uitat parola aplicației').onclick();
  assert.deepEqual(h.calls.auth, [{ kind: 'reset', email: 'reset.salon@example.test' }]);
  email.value = ''; email.oninput(); h.refresh(); assert.equal(input(h.manager.renderSettings(), 'E-mail cont aplicație').value, '');
});

test('changing UID blocks every cloud action, closes the old channel and leaves the local salon intact', async () => {
  const h = harness(); await tick();
  await h.button('Verifică backupurile Firebase').onclick(); assert.equal(historySelect(h.settings).children.length, 1);
  const before = h.bundle(); h.setUser(otherUser);
  for (const label of ['Conectează agenda Firebase', 'Sincronizează acum', 'Fă backup Firebase acum', 'Restaurează backupul Firebase ales']) assert.equal(h.button(label).disabled, true, label);
  assert.equal(historySelect(h.settings).disabled, true); assert.equal(historySelect(h.settings).children.length, 0);
  assert.match(h.manager.status(), /altui cont/);
  assert(walk(h.settings).some(element => element.textContent === otherUser.email));
  assert(!walk(h.settings).some(element => String(element.textContent).startsWith('Ultimul backup Firebase:')));
  assert.equal(h.calls.closed, 1); assert.equal(h.calls.unsubscribed, 1);
  assert(h.calls.transports.every(uid => uid === ownerUser.uid)); assert.deepEqual(h.bundle(), before);
  h.setUser(ownerUser); await h.button('Sincronizează acum').onclick(); assert.equal(h.calls.uploads.length, 1);
  assert.equal(h.bundle().device.firebaseUid, ownerUser.uid);
});

test('a pending bootstrap from another UID and an unbound existing journal cannot be rebound automatically', async () => {
  for (const metadata of [
    { ...unjoined(), bootstrapIntent: { uid: 'another-owner', workspace: 'workspace-test', genesisHash: '0'.repeat(64) } },
    (() => { const result = harness().bundle().device; delete result.firebaseUid; return result; })()
  ]) {
    const h = harness({ metadata }), before = h.bundle(); await tick();
    assert.equal(h.button('Sincronizează acum').disabled, true);
    await h.button('Sincronizează acum').onclick();
    assert.equal(h.calls.transports.length, 0); assert.equal(h.calls.uploads.length, 0); assert.deepEqual(h.bundle(), before);
  }
});

test('a late backup-status result cannot upload old local data after an identity change', async () => {
  const h = harness(), entered = deferred(), release = deferred();
  h.channel.backupStatus = async () => { entered.resolve(); return release.promise; };
  const operation = h.button('Fă backup Firebase acum').onclick(); await entered.promise;
  const before = h.bundle(); h.setUser(otherUser); release.resolve({ revision: 'old-backup' }); await operation;
  assert.equal(h.calls.backups.length, 0); assert.deepEqual(h.bundle(), before);
  assert.equal(historySelect(h.settings).children.length, 0); assert.match(h.manager.status(), /altui cont/);
});

test('a late completed backup cannot rewrite metadata or expose old history under the new identity', async () => {
  const h = harness(), entered = deferred(), release = deferred(), original = h.channel.backup;
  h.channel.backup = async snapshot => { const response = await original(snapshot); entered.resolve(); await release.promise; return response; };
  const operation = h.button('Fă backup Firebase acum').onclick(); await entered.promise;
  const before = h.bundle(); h.setUser(otherUser); release.resolve(); await operation;
  assert.equal(h.calls.backups.length, 1); assert.deepEqual(h.bundle(), before);
  assert.equal(h.bundle().device.backup.lastBackup, null); assert.equal(historySelect(h.settings).children.length, 0);
});

test('late history and ABA account transitions cannot revive another identity cloud state', async () => {
  const h = harness(), entered = deferred(), release = deferred();
  h.channel.listBackups = async () => { entered.resolve(); return release.promise; };
  const operation = h.button('Verifică backupurile Firebase').onclick(); await entered.promise;
  h.setUser(otherUser); h.setUser(ownerUser);
  release.resolve([{ revision: 'stale-a-backup', day: '2026-11-03', modifiedAt: '2026-11-03T10:00:00Z' }]); await operation;
  assert.equal(historySelect(h.settings).children.length, 0, 'Returning to the same UID does not authorize an older channel completion');
  const runEntered = deferred(), runRelease = deferred(), workspace = h.channel.workspace;
  h.channel.workspace = async () => { runEntered.resolve(); await runRelease.promise; return workspace(); };
  const before = h.bundle(), run = h.button('Sincronizează acum').onclick(); await runEntered.promise;
  h.setUser(otherUser); h.setUser(ownerUser); runRelease.resolve(); await run;
  assert.deepEqual(h.bundle(), before); assert.equal(h.calls.uploads.length, 0);
});
