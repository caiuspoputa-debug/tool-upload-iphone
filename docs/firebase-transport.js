/* Firebase compat transport. Local business data is committed by the caller.
 * Large payloads are immutable, chunked and verified before any state is used.
 * Publishing the small head is the final atomic step of every upload.
 */
(function (g) {
  'use strict';
  const MAX_BYTES = 30 * 1024 * 1024, CHUNK_BYTES = 128 * 1024, MAX_CHUNKS = 256;
  const hashPattern = /^[a-f0-9]{64}$/, idPattern = /^[A-Za-z0-9_-]{1,128}$/;
  const clone = value => JSON.parse(JSON.stringify(value));
  const problem = (message, code) => Object.assign(Error(message), { code });
  const invalid = () => problem('Datele Firebase nu pot fi verificate. Agenda locală este păstrată.', 'invalid_remote');
  const missing = () => problem('Revizia din cloud a fost înlocuită în timpul citirii. Reîncearcă sincronizarea.', 'missing_revision');
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  async function digest(bytes) {
    return Array.from(new Uint8Array(await g.crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  }
  function encode(bytes) {
    let text = ''; for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return g.btoa(text);
  }
  function decode(text) {
    if (typeof text !== 'string' || !text.length || text.length > 204800 || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw invalid();
    let binary; try { binary = g.atob(text); } catch (_) { throw invalid(); }
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    if (encode(bytes) !== text || bytes.length > CHUNK_BYTES) throw invalid();
    return bytes;
  }
  function checkedManifest(value, revision) {
    if (!value || value.version !== 1 || !hashPattern.test(value.sha256) || !hashPattern.test(revision) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_BYTES || !Number.isSafeInteger(value.chunkCount) || value.chunkCount < 1 || value.chunkCount > MAX_CHUNKS || value.chunkCount !== Math.ceil(value.bytes / CHUNK_BYTES) || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw invalid();
    return value;
  }
  function create(options) {
    const { db, uid, validate } = options || {};
    if (!db || !idPattern.test(uid) || typeof validate !== 'function') throw Error('Configurația Firebase este incompletă.');
    const base = 'accounts/' + uid + '/workspaces/main', rootRef = db.doc(base);
    const payloadRef = sha => db.doc(base + '/payloads/' + sha);
    const chunkRef = (sha, index) => db.doc(base + '/payloads/' + sha + '/chunks/' + String(index).padStart(4, '0'));
    const currentRef = db.doc(base + '/backupState/current');
    const cache = new Map(), manifests = new Map(), loading = new Map(), listeners = new Set();
    let cachedRoot = null, closed = false, maintenancePending = false;
    function active() { if (closed) throw problem('Conexiunea Firebase a fost închisă.', 'disconnected'); }
    function remember(revision, value, manifest) {
      cache.delete(revision); cache.set(revision, value); manifests.set(revision, manifest);
      // Keep current/recent decoded bodies, not every remote revision observed
      // during a long-running session. In-flight reads remain independent.
      while (cache.size > 64) cache.delete(cache.keys().next().value);
    }
    const normal = value => clone(validate(clone(value)));
    async function server(ref) { active(); const snapshot = await ref.get({ source: 'server' }); active(); return snapshot; }
    function rootData(value) {
      if (!value || value.version !== 1 || value.protocol !== 'frizerie-firebase-1' || !idPattern.test(value.workspace) || !hashPattern.test(value.genesisRevision) || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw invalid();
      return value;
    }
    async function readPayload(revision) {
      active(); if (!hashPattern.test(revision)) throw invalid();
      if (cache.has(revision)) { const value = cache.get(revision); cache.delete(revision); cache.set(revision, value); return clone(value); }
      if (loading.has(revision)) return clone(await loading.get(revision));
      const promise = (async () => {
        const manifestSnapshot = await server(payloadRef(revision));
        if (!manifestSnapshot.exists) throw missing();
        const manifest = checkedManifest(manifestSnapshot.data(), revision), bytes = new Uint8Array(manifest.bytes);
        // A small bounded group avoids hundreds of simultaneous requests.
        for (let start = 0; start < manifest.chunkCount; start += 8) {
          const snapshots = await Promise.all(Array.from({ length: Math.min(8, manifest.chunkCount - start) }, (_, offset) => server(chunkRef(revision, start + offset))));
          for (let offset = 0; offset < snapshots.length; offset++) {
            const index = start + offset, snapshot = snapshots[offset]; if (!snapshot.exists) throw missing(); const chunk = snapshot.data();
            if (!chunk || chunk.version !== 1 || chunk.index !== index) throw invalid();
            const part = decode(chunk.payload), expected = Math.min(CHUNK_BYTES, manifest.bytes - index * CHUNK_BYTES);
            if (part.length !== expected) throw invalid();
            bytes.set(part, index * CHUNK_BYTES);
          }
        }
        if (await digest(bytes) !== manifest.sha256) throw invalid();
        let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch (_) { throw invalid(); }
        active(); remember(revision, value, manifest); return value;
      })();
      loading.set(revision, promise);
      try { return clone(await promise); } finally { loading.delete(revision); }
    }
    async function prepared(value) {
      const bytes = new TextEncoder().encode(canonical(value));
      if (!bytes.length || bytes.length > MAX_BYTES) throw problem('Datele depășesc limita de 30 MB. Exportă și arhivează agenda.', 'payload_too_large');
      return { bytes, sha256: await digest(bytes) };
    }
    async function stage(value, encoded) {
      active(); const { bytes, sha256 } = encoded || await prepared(value);
      // A revision is a unique publication identity, never a reusable content hash.
      // Therefore its previous owner can safely retire it after publishing a replacement.
      const revision = Array.from(g.crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
      const reference = payloadRef(revision);
        const count = Math.ceil(bytes.length / CHUNK_BYTES);
        if (count > MAX_CHUNKS) throw problem('Datele necesită arhivare înainte de sincronizare.', 'payload_too_large');
        try {
        // At most ~2.1 MiB of base64 per batch, safely below Firestore's 10 MiB request limit.
        for (let start = 0; start < count; start += 12) {
          active(); const batch = db.batch();
          for (let index = start; index < Math.min(count, start + 12); index++) batch.set(chunkRef(revision, index), { version: 1, index, payload: encode(bytes.subarray(index * CHUNK_BYTES, Math.min(bytes.length, (index + 1) * CHUNK_BYTES))) });
          await batch.commit(); active();
        }
        const proposed = { version: 1, sha256, bytes: bytes.length, chunkCount: count, createdAt: Date.now() };
        const manifest = await db.runTransaction(async transaction => {
          active(); const existing = await transaction.get(reference);
          if (existing.exists) throw problem('Identificator de transfer duplicat. Reîncearcă.', 'revision_collision');
          transaction.set(reference, proposed); return proposed;
        });
        active(); remember(revision, clone(value), manifest); return { ...manifest, revision };
        } catch (error) { await bestEffortRetire(revision, count); throw error; }
    }
    async function retire(revision, knownCount) {
      if (!revision) return;
      let count = knownCount;
      if (!count) { const snapshot = await server(payloadRef(revision)); if (!snapshot.exists) return; count = checkedManifest(snapshot.data(), revision).chunkCount; }
      for (let start = 0; start < count; start += 12) {
        active(); const batch = db.batch();
        for (let index = start; index < Math.min(count, start + 12); index++) batch.delete(chunkRef(revision, index));
        await batch.commit();
      }
      await payloadRef(revision).delete(); cache.delete(revision); manifests.delete(revision);
    }
    async function bestEffortRetire(revision, knownCount) {
      try { await retire(revision, knownCount); } catch (_) { maintenancePending = true; /* A confirmed replacement remains valid when cleanup is temporarily unavailable. */ }
    }
    async function workspace() {
      active(); if (cachedRoot) return clone(cachedRoot);
      const snapshot = await server(rootRef); if (!snapshot.exists) return null;
      const root = rootData(snapshot.data()), genesis = normal(await readPayload(root.genesisRevision));
      cachedRoot = { ...root, genesis }; return clone(cachedRoot);
    }
    async function bootstrap(genesis, proposedWorkspace) {
      active(); if (!idPattern.test(proposedWorkspace)) throw Error('Identificator de agendă invalid.');
      const existing = await workspace(); if (existing) return existing;
      const normalized = normal(genesis), payload = await stage(normalized);
      await db.runTransaction(async transaction => {
        active(); const current = await transaction.get(rootRef);
        if (current.exists) { rootData(current.data()); return; }
        const persisted = await transaction.get(payloadRef(payload.revision));
        if (!persisted.exists) throw invalid(); checkedManifest(persisted.data(), payload.revision);
        transaction.set(rootRef, { version: 1, protocol: 'frizerie-firebase-1', workspace: proposedWorkspace, genesisRevision: payload.revision, createdAt: Date.now() });
      });
      // A committed create is not enough to adopt a workspace: a concurrent
      // deletion or an interrupted confirmation read must not replace local data.
      // Confirm a fresh server result before using it or retiring any payload.
      let winner = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        cachedRoot = null;
        winner = await workspace();
        if (winner) break;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      }
      if (!winner) throw problem('Confirmarea agendei Firebase nu a putut fi citită. Datele locale sunt păstrate. Apasă „Conectează agenda Firebase” pentru reîncercare.', 'workspace_confirmation_missing');
      if (winner.genesisRevision !== payload.revision) await bestEffortRetire(payload.revision);
      return winner;
    }
    function checkedHead(value, device, root) {
      if (!value || value.version !== 1 || value.workspace !== root.workspace || value.device !== device || !idPattern.test(device) || !hashPattern.test(value.revision) || !hashPattern.test(value.sha256) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_BYTES || !Number.isSafeInteger(value.chunkCount) || value.chunkCount !== Math.ceil(value.bytes / CHUNK_BYTES) || value.chunkCount > MAX_CHUNKS || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) throw invalid();
      return value;
    }
    async function list(attempt = 0) {
      try {
      const root = await workspace(); if (!root) return [];
      const snapshot = await server(db.collection(base + '/journals'));
      if (snapshot.docs.length > 100) throw problem('Sunt prea multe dispozitive în această agendă.', 'too_many_devices');
      const result = [];
      for (const item of snapshot.docs) {
        const head = checkedHead(item.data(), item.id, root), body = await readPayload(head.revision);
        const manifest = manifests.get(head.revision);
        if (manifest.sha256 !== head.sha256 || manifest.bytes !== head.bytes || manifest.chunkCount !== head.chunkCount) throw invalid();
        if (!body || body.protocol !== 'frizerie-drive-1' || body.workspace !== root.workspace || body.device !== item.id || !Array.isArray(body.operations) || body.operations.length > 10000) throw invalid();
        result.push({ fileId: item.id, revision: head.revision, doc: { ...body, genesis: clone(root.genesis) } });
      }
      return result;
      } catch (error) { if (error.code === 'missing_revision' && attempt < 2) return list(attempt + 1); throw error; }
    }
    async function upload(doc, expectedRevision = null) {
      active(); const root = await workspace();
      if (!root || !doc || doc.protocol !== 'frizerie-drive-1' || doc.workspace !== root.workspace || !idPattern.test(doc.device) || !Array.isArray(doc.operations) || doc.operations.length > 10000) throw invalid();
      if (canonical(normal(doc.genesis)) !== canonical(root.genesis)) throw problem('Agenda Firebase are altă origine. Datele locale sunt păstrate.', 'workspace_mismatch');
      const body = { protocol: doc.protocol, workspace: doc.workspace, device: doc.device, operations: clone(doc.operations) }, encoded = await prepared(body), reference = db.doc(base + '/journals/' + doc.device);
      const previous = await server(reference), previousHead = previous.exists ? checkedHead(previous.data(), doc.device, root) : null;
      if (previousHead?.sha256 === encoded.sha256) return { fileId: doc.device, revision: previousHead.revision };
      if ((previousHead?.revision || null) !== expectedRevision) throw problem('Jurnalul din cloud s-a schimbat. Sincronizează înainte de reîncercare.', 'remote_changed');
      const payload = await stage(body, encoded);
      let result; try { result = await db.runTransaction(async transaction => {
        active(); const snapshot = await transaction.get(reference);
        const current = snapshot.exists ? checkedHead(snapshot.data(), doc.device, root) : null;
        if (current?.sha256 === payload.sha256) return { fileId: doc.device, revision: current.revision, unused: payload.revision };
        if ((current?.revision || null) !== expectedRevision) throw problem('Jurnalul din cloud s-a schimbat. Sincronizează înainte de reîncercare.', 'remote_changed');
        const persisted = await transaction.get(payloadRef(payload.revision));
        if (!persisted.exists) throw invalid(); checkedManifest(persisted.data(), payload.revision);
        transaction.set(reference, { version: 1, workspace: root.workspace, device: doc.device, revision: payload.revision, sha256: payload.sha256, bytes: payload.bytes, chunkCount: payload.chunkCount, updatedAt: Date.now() });
        return { fileId: doc.device, revision: payload.revision, retired: current?.revision };
      }); } catch (error) { if (error.code === 'remote_changed') await bestEffortRetire(payload.revision); throw error; }
      await bestEffortRetire(result.retired || result.unused); return { fileId: result.fileId, revision: result.revision };
    }
    function checkedPointer(value, root) {
      if (!value || value.version !== 1 || value.workspace !== root.workspace || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !hashPattern.test(value.revision) || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) throw invalid();
      return value;
    }
    const info = pointer => pointer ? { hasBackup: true, revision: pointer.revision, day: pointer.day, modifiedAt: new Date(pointer.updatedAt).toISOString() } : { hasBackup: false, revision: null, modifiedAt: null };
    async function backupStatus() {
      const root = await workspace(); if (!root) return info(null);
      const snapshot = await server(currentRef); return info(snapshot.exists ? checkedPointer(snapshot.data(), root) : null);
    }
    function checkedBackup(value, day, root) {
      let validDay = false; try { validDay = /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day; } catch (_) {}
      if (!validDay || !value || value.version !== 1 || value.workspace !== root.workspace || !hashPattern.test(value.revision) || !hashPattern.test(value.sha256) || !idPattern.test(value.sourceDevice) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_BYTES || !Number.isSafeInteger(value.chunkCount) || value.chunkCount !== Math.ceil(value.bytes / CHUNK_BYTES) || value.chunkCount > MAX_CHUNKS || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 || !Number.isFinite(new Date(value.createdAt).getTime())) throw invalid();
      return value;
    }
    async function backupDays() {
      const root = await workspace(); if (!root) return [];
      const snapshot = await server(db.collection(base + '/backups'));
      return snapshot.docs.map(item => ({ ...checkedBackup(item.data(), item.id, root), day: item.id })).sort((a, b) => b.day.localeCompare(a.day));
    }
    async function listBackups() {
      return (await backupDays()).map(item => ({ revision: item.revision, day: item.day, modifiedAt: new Date(item.createdAt).toISOString(), sourceDevice: item.sourceDevice }));
    }
    async function pruneBackupDays() {
      const snapshot = await server(db.collection(base + '/backups')), days = snapshot.docs.filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.id)).sort((a, b) => b.id.localeCompare(a.id));
      for (const item of days.slice(7)) {
        const retired = await db.runTransaction(async transaction => {
          active(); const current = await transaction.get(currentRef), candidate = await transaction.get(item.ref || db.doc(base + '/backups/' + item.id));
          if (!candidate.exists || current.exists && current.data().day === item.id) return null;
          if (candidate.data().revision === item.data().revision) { transaction.delete(item.ref || db.doc(base + '/backups/' + item.id)); return candidate.data().revision; }
          return null;
        });
        await bestEffortRetire(retired);
      }
    }
    async function backup(state, device, expectedRevision = null) {
      active(); if (!idPattern.test(device)) throw Error('Identificator de dispozitiv invalid.');
      const root = await workspace(); if (!root) throw problem('Creează mai întâi agenda comună Firebase.', 'workspace_missing');
      const normalized = normal(state), encoded = await prepared(normalized), previous = await server(currentRef), previousPointer = previous.exists ? checkedPointer(previous.data(), root) : null;
      if (previousPointer) {
        const previousPayload = await server(payloadRef(previousPointer.revision));
        if (!previousPayload.exists) throw invalid();
        if (checkedManifest(previousPayload.data(), previousPointer.revision).sha256 === encoded.sha256) return info(previousPointer);
      }
      if ((previousPointer?.revision || null) !== expectedRevision) throw problem('Backupul din cloud s-a schimbat. Verifică sau restaurează copia înainte de înlocuire.', 'remote_changed');
      const payload = await stage(normalized, encoded), now = Date.now(), date = new Date(now), day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'), dayRef = db.doc(base + '/backups/' + day);
      let result; try { result = await db.runTransaction(async transaction => {
        active(); const snapshot = await transaction.get(currentRef), current = snapshot.exists ? checkedPointer(snapshot.data(), root) : null;
        if ((current?.revision || null) !== expectedRevision) throw problem('Backupul din cloud s-a schimbat. Verifică sau restaurează copia înainte de înlocuire.', 'remote_changed');
        const persisted = await transaction.get(payloadRef(payload.revision)), previousDay = await transaction.get(dayRef);
        if (!persisted.exists) throw invalid(); checkedManifest(persisted.data(), payload.revision);
        transaction.set(dayRef, { version: 1, workspace: root.workspace, revision: payload.revision, sha256: payload.sha256, bytes: payload.bytes, chunkCount: payload.chunkCount, createdAt: now, sourceDevice: device });
        const pointer = { version: 1, workspace: root.workspace, day, revision: payload.revision, updatedAt: now };
        transaction.set(currentRef, pointer); return { ...info(pointer), retired: previousDay.exists ? previousDay.data().revision : null };
      }); } catch (error) { if (error.code === 'remote_changed') await bestEffortRetire(payload.revision); throw error; }
      await bestEffortRetire(result.retired); delete result.retired;
      try { await pruneBackupDays(); } catch (_) { maintenancePending = true; /* A successful backup remains successful if retention maintenance fails. */ }
      return result;
    }
    async function restore(revision, attempt = 0) {
      const explicit = !!revision;
      try {
      const root = await workspace(); if (!root) throw problem('Nu există o agendă Firebase pentru acest cont.', 'no_backup');
      const status = await backupStatus();
      revision = revision || status.revision;
      if (!revision) throw problem('Nu există un backup Firebase în acest cont.', 'no_backup');
      if (!hashPattern.test(revision)) throw invalid();
      const matching = (await backupDays()).find(item => item.revision === revision);
      if (!matching) { if (!explicit) throw missing(); throw problem('Backupul ales nu mai este în istoricul disponibil.', 'no_backup'); }
      const restored = normal(await readPayload(revision)), manifest = manifests.get(revision);
      if (manifest.sha256 !== matching.sha256 || manifest.bytes !== matching.bytes || manifest.chunkCount !== matching.chunkCount) throw invalid();
      return { state: restored, revision, modifiedAt: new Date(matching.createdAt).toISOString() };
      } catch (error) { if (!explicit && error.code === 'missing_revision' && attempt < 2) return restore(undefined, attempt + 1); throw error; }
    }
    function subscribe(onChange, onError = () => {}) {
      active(); const removers = [], last = new Map(); let stopped = false;
      function watch(reference, kind) {
        removers.push(reference.onSnapshot({ includeMetadataChanges: true }, snapshot => {
          if (stopped || closed || snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) return;
          const value = snapshot.docs ? snapshot.docs.map(item => [item.id, item.data().revision]).sort((a, b) => a[0].localeCompare(b[0])) : snapshot.exists ? snapshot.data() : null;
          const key = canonical(value); if (last.get(kind) === key) return; last.set(kind, key);
          try { onChange({ kind }); } catch (error) { onError(error); }
        }, error => { if (!stopped && !closed) onError(error); }));
      }
      watch(rootRef, 'workspace'); watch(db.collection(base + '/journals'), 'journals');
      const unsubscribe = () => { if (stopped) return; stopped = true; for (const remove of removers) remove(); listeners.delete(unsubscribe); };
      listeners.add(unsubscribe); return unsubscribe;
    }
    function close() { if (closed) return; closed = true; for (const unsubscribe of [...listeners]) unsubscribe(); cache.clear(); manifests.clear(); cachedRoot = null; }
    return { workspace, bootstrap, list, upload, subscribe, backup, backupStatus, listBackups, restore, close, maintenancePending: () => maintenancePending };
  }
  const api = { create }; g.SalonFirebaseTransport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
