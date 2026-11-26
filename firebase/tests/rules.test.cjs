'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, collection, collectionGroup, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, setLogLevel } = require('firebase/firestore');

// This suite has no production project, credential, or endpoint fallback.
const PROJECT = 'demo-agenda-frizerie';
const UID = 'owner-test-uid';
const EMAIL = 'macsocietysrl@gmail.com';
const APPROVAL = `salonAccess/${EMAIL}`;
const ROOT = `accounts/${UID}/workspaces/main`;
const SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);
const WORKSPACE = 'workspace-test-1';
const NOW = 1793700000000;
let environment;
setLogLevel('silent');

const rootData = () => ({ version: 1, protocol: 'frizerie-firebase-1', workspace: WORKSPACE, genesisRevision: SHA, createdAt: NOW });
const blobData = (sha = SHA) => ({ version: 1, sha256: sha, bytes: 3, chunkCount: 1, createdAt: NOW });
const chunkData = () => ({ version: 1, index: 0, payload: 'YWJj' });
const headData = () => ({ version: 1, workspace: WORKSPACE, device: 'android-test', revision: SHA, sha256: SHA, bytes: 3, chunkCount: 1, updatedAt: NOW });
const backupData = () => ({ version: 1, workspace: WORKSPACE, revision: SHA, sha256: SHA, bytes: 3, chunkCount: 1, createdAt: NOW, sourceDevice: 'android-test' });
const stateData = () => ({ version: 1, workspace: WORKSPACE, day: '2026-11-03', revision: SHA, updatedAt: NOW });
const documents = () => [
  [ROOT, rootData()],
  [`${ROOT}/payloads/${SHA}`, blobData()],
  [`${ROOT}/payloads/${SHA}/chunks/0000`, chunkData()],
  [`${ROOT}/journals/android-test`, headData()],
  [`${ROOT}/backups/2026-11-03`, backupData()],
  [`${ROOT}/backupState/current`, stateData()]
];
const context = (uid = UID, claims = { email: EMAIL, email_verified: true }) => environment.authenticatedContext(uid, claims).firestore();
const owner = () => context();
async function seed() {
  await environment.withSecurityRulesDisabled(async admin => {
    const db = admin.firestore();
    await Promise.all(documents().map(([name, data]) => setDoc(doc(db, name), data)));
  });
}

before(async () => {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  assert.match(emulator || '', /^(127\.0\.0\.1|localhost):17880$/, 'Run through npm test so every request targets the local emulator.');
  environment = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { host: '127.0.0.1', port: 17880, rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') }
  });
});
beforeEach(async () => {
  await environment.clearFirestore();
  // Migration must seed this record before deploying the new policy. The old
  // account keeps exactly the same UID root; there is no special-case bypass.
  await environment.withSecurityRulesDisabled(admin => setDoc(doc(admin.firestore(), APPROVAL), { enabled: true }));
});
after(async () => { if (environment) await environment.cleanup(); });

test('verified approved owner creates, reads and updates the supported protocol', async () => {
  const db = owner();
  for (const [name, data] of documents()) {
    await assertSucceeds(setDoc(doc(db, name), data));
    assert.deepEqual((await assertSucceeds(getDoc(doc(db, name)))).data(), data);
  }
  await assertSucceeds(updateDoc(doc(db, `${ROOT}/journals/android-test`), { revision: OTHER_SHA, updatedAt: NOW + 1 }));
  await assertSucceeds(updateDoc(doc(db, `${ROOT}/backups/2026-11-03`), { revision: OTHER_SHA }));
  await assertSucceeds(updateDoc(doc(db, `${ROOT}/backupState/current`), { revision: OTHER_SHA }));
  assert.equal((await assertSucceeds(getDocs(collection(db, `${ROOT}/journals`)))).size, 1);
});

for (const [label, makeDb] of [
  ['unauthenticated', () => environment.unauthenticatedContext().firestore()],
  ['different UID', () => context('other-test-uid')],
  ['wrong email', () => context(UID, { email: 'other@example.com', email_verified: true })],
  ['unverified email', () => context(UID, { email: EMAIL, email_verified: false })],
  ['missing email verification', () => context(UID, { email: EMAIL })],
  ['nonboolean email verification', () => context(UID, { email: EMAIL, email_verified: 'true' })]
]) {
  test(`${label} cannot read, write or delete any owned protocol document`, async () => {
    await seed();
    const db = makeDb();
    for (const [name, data] of documents()) {
      await assertFails(getDoc(doc(db, name)));
      await assertFails(setDoc(doc(db, name), data));
      await assertFails(deleteDoc(doc(db, name)));
    }
  });
}

test('owner cannot query across accounts or write unsupported paths', async () => {
  await seed();
  const db = owner();
  await assertFails(getDocs(collection(db, 'accounts')));
  await assertFails(getDocs(collectionGroup(db, 'journals')));
  await assertFails(setDoc(doc(db, `accounts/${UID}`), { admin: true }));
  await assertFails(setDoc(doc(db, `accounts/${UID}/workspaces/other`), rootData()));
  await assertFails(setDoc(doc(db, `${ROOT}/unexpected/document`), { payload: 'abc' }));
  await assertFails(setDoc(doc(db, `${ROOT}/backupState/other`), stateData()));
});

test('all schemas reject unknown fields and invalid version types', async () => {
  const db = owner();
  for (const [name, data] of documents()) {
    await assertFails(setDoc(doc(db, name), { ...data, admin: true }));
    await assertFails(setDoc(doc(db, name), { ...data, version: '1' }));
    const missing = { ...data }; delete missing.version;
    await assertFails(setDoc(doc(db, name), missing));
  }
});

test('workspace is immutable and cannot be deleted by a client', async () => {
  const db = owner(), ref = doc(db, ROOT);
  await assertSucceeds(setDoc(ref, rootData()));
  await assertSucceeds(setDoc(ref, rootData()));
  await assertFails(updateDoc(ref, { genesisRevision: OTHER_SHA }));
  await assertFails(updateDoc(ref, { workspace: 'another-workspace' }));
  await assertFails(deleteDoc(ref));
});

test('root metadata validates protocol, IDs, hashes and integer timestamps', async () => {
  const db = owner(), ref = doc(db, ROOT);
  for (const change of [
    { protocol: 'other-protocol' }, { workspace: '' }, { workspace: 'x'.repeat(129) },
    { workspace: 'bad/workspace' }, { genesisRevision: SHA.toUpperCase() },
    { createdAt: -1 }, { createdAt: 1.5 }, { createdAt: 9007199254740992 }
  ]) await assertFails(setDoc(ref, { ...rootData(), ...change }));
});

test('immutable generation manifests and chunks accept only identical repeated writes', async () => {
  const db = owner(), manifest = doc(db, `${ROOT}/payloads/${SHA}`), chunk = doc(db, `${ROOT}/payloads/${SHA}/chunks/0000`);
  await assertSucceeds(setDoc(manifest, blobData()));
  await assertSucceeds(setDoc(manifest, blobData()));
  await assertFails(updateDoc(manifest, { bytes: 4 }));
  await assertFails(updateDoc(manifest, { createdAt: NOW + 1 }));
  await assertSucceeds(setDoc(chunk, chunkData()));
  await assertSucceeds(setDoc(chunk, chunkData()));
  await assertFails(updateDoc(chunk, { payload: 'ZGVm' }));
  await assertSucceeds(deleteDoc(chunk));
  await assertSucceeds(deleteDoc(manifest));
});

test('blob manifest limits validate independent generation IDs and checksums', async () => {
  const db = owner(), ref = doc(db, `${ROOT}/payloads/${SHA}`);
  for (const change of [
    { sha256: 'invalid-digest' }, { bytes: -1 }, { bytes: 31457281 }, { bytes: 1.5 },
    { chunkCount: 0 }, { chunkCount: 257 }, { chunkCount: '1' }
  ]) await assertFails(setDoc(ref, { ...blobData(), ...change }));
  await assertFails(setDoc(doc(db, `${ROOT}/payloads/not-a-digest`), blobData()));
  await assertSucceeds(setDoc(ref, { ...blobData(OTHER_SHA), bytes: 31457280, chunkCount: 256 }));
});

test('chunks enforce 200KiB standard base64, index types and padded document IDs', async () => {
  const db = owner(), ref = doc(db, `${ROOT}/payloads/${SHA}/chunks/0000`);
  for (const change of [
    { index: -1 }, { index: 256 }, { index: '0' }, { payload: '' }, { payload: 123 },
    { payload: 'A'.repeat(204804) }, { payload: 'é'.repeat(204800) },
    { payload: 'YW-J' }, { payload: 'YW_J' }, { payload: 'abc' }, { payload: '=abc' }
  ]) await assertFails(setDoc(ref, { ...chunkData(), ...change }));
  await assertFails(setDoc(doc(db, `${ROOT}/payloads/${SHA}/chunks/0`), chunkData()));
  await assertFails(setDoc(doc(db, `${ROOT}/payloads/not-a-digest/chunks/0000`), chunkData()));
  await assertSucceeds(setDoc(ref, { ...chunkData(), payload: 'A'.repeat(204800) }));
  await assertSucceeds(setDoc(doc(db, `${ROOT}/payloads/${SHA}/chunks/0255`), { ...chunkData(), index: 255 }));
});

test('journal heads bind the device field to its path and validate size, revision and time', async () => {
  const db = owner(), ref = doc(db, `${ROOT}/journals/android-test`);
  for (const change of [
    { device: 'other-device' }, { workspace: '' }, { revision: 'bad' }, { sha256: 'bad' },
    { bytes: 31457281 }, { chunkCount: 257 }, { updatedAt: -1 }
  ]) await assertFails(setDoc(ref, { ...headData(), ...change }));
  await assertSucceeds(setDoc(ref, headData()));
  await assertSucceeds(deleteDoc(ref));
});

test('daily backups and the current pointer validate dates and source devices', async () => {
  const db = owner(), ref = doc(db, `${ROOT}/backups/2026-11-03`);
  await assertFails(setDoc(doc(db, `${ROOT}/backups/2026-99-99`), backupData()));
  await assertFails(setDoc(doc(db, `${ROOT}/backups/not-a-day`), backupData()));
  await assertFails(setDoc(ref, { ...backupData(), sourceDevice: '' }));
  await assertFails(setDoc(ref, { ...backupData(), createdAt: 1.5 }));
  await assertFails(setDoc(doc(db, `${ROOT}/backupState/current`), { ...stateData(), day: '2026-13-01' }));
  await assertSucceeds(setDoc(ref, backupData()));
  await assertSucceeds(setDoc(doc(db, `${ROOT}/backupState/current`), stateData()));
  await assertSucceeds(deleteDoc(ref));
  await assertSucceeds(deleteDoc(doc(db, `${ROOT}/backupState/current`)));
});

test('a forbidden write rejects the whole client batch', async () => {
  const db = owner(), batch = writeBatch(db);
  batch.set(doc(db, `${ROOT}/journals/android-test`), headData());
  batch.set(doc(db, `accounts/not-owner/workspaces/main`), rootData());
  await assertFails(batch.commit());
  assert.equal((await assertSucceeds(getDoc(doc(db, `${ROOT}/journals/android-test`)))).exists(), false);
});

test('two approved verified salons use separate UID roots and cannot access each other', async () => {
  const salons=[['salon-a-uid','salon-a@example.test'],['salon-b-uid','salon-b@example.test']];
  await environment.withSecurityRulesDisabled(async admin=>{
    for(const [,email]of salons)await setDoc(doc(admin.firestore(),`salonAccess/${email}`),{enabled:true});
  });
  for(const [uid,email]of salons){
    const db=context(uid,{email,email_verified:true}),base=`accounts/${uid}/workspaces/main`;
    for(const [name,data]of documents()){
      const target=name.replace(ROOT,base);
      await assertSucceeds(setDoc(doc(db,target),data));
      assert.deepEqual((await assertSucceeds(getDoc(doc(db,target)))).data(),data);
    }
  }
  for(const [uid,email]of salons){
    const db=context(uid,{email,email_verified:true}),other=salons.find(([id])=>id!==uid)[0],base=`accounts/${other}/workspaces/main`;
    for(const [name,data]of documents()){
      const target=name.replace(ROOT,base);
      await assertFails(getDoc(doc(db,target)));
      await assertFails(setDoc(doc(db,target),data));
      await assertFails(deleteDoc(doc(db,target)));
    }
    await assertFails(getDocs(collection(db,'accounts')));
    await assertFails(getDocs(collectionGroup(db,'journals')));
    await assertFails(getDocs(collectionGroup(db,'backups')));
  }
});

test('approval can precede registration and email matching uses the canonical lowercase ID', async () => {
  const address='salon-new@example.test',uid='salon-new-uid',base=`accounts/${uid}/workspaces/main`;
  await environment.withSecurityRulesDisabled(admin=>setDoc(doc(admin.firestore(),`salonAccess/${address}`),{enabled:true}));
  const db=context(uid,{email:'Salon-New@EXAMPLE.TEST',email_verified:true});
  await assertSucceeds(setDoc(doc(db,base),rootData()));
  assert.deepEqual((await assertSucceeds(getDoc(doc(db,base)))).data(),rootData());
});

test('verified but unapproved or disabled salons cannot create their own agenda', async () => {
  for(const [uid,email,record]of [
    ['unapproved-uid','unapproved@example.test',null],
    ['disabled-uid','disabled@example.test',{enabled:false}],
    ['invalid-flag-uid','flag@example.test',{enabled:'true'}],
    ['missing-flag-uid','missing@example.test',{}]
  ]){
    if(record)await environment.withSecurityRulesDisabled(admin=>setDoc(doc(admin.firestore(),`salonAccess/${email}`),record));
    const db=context(uid,{email,email_verified:true}),base=`accounts/${uid}/workspaces/main`;
    for(const [name,data]of documents()){
      const target=name.replace(ROOT,base);
      await assertFails(getDoc(doc(db,target)));
      await assertFails(setDoc(doc(db,target),data));
      await assertFails(deleteDoc(doc(db,target)));
    }
  }
});

test('approval does not replace email verification and a changed unapproved email loses access', async () => {
  await seed();
  for(const claims of [{email:EMAIL,email_verified:false},{email:EMAIL},{email:EMAIL,email_verified:'true'},{email:'new-unapproved@example.test',email_verified:true}]){
    const db=context(UID,claims);
    for(const [name,data]of documents()){
      await assertFails(getDoc(doc(db,name)));
      await assertFails(setDoc(doc(db,name),data));
      await assertFails(deleteDoc(doc(db,name)));
    }
  }
});

test('all app clients are denied approval reads, listing, self-approval, changes and deletion', async () => {
  for(const db of [owner(),context('unapproved-uid',{email:'unapproved@example.test',email_verified:true}),environment.unauthenticatedContext().firestore()]){
    await assertFails(getDoc(doc(db,APPROVAL)));
    await assertFails(getDocs(collection(db,'salonAccess')));
    await assertFails(setDoc(doc(db,'salonAccess/unapproved@example.test'),{enabled:true}));
    await assertFails(setDoc(doc(db,APPROVAL),{enabled:true}));
    await assertFails(updateDoc(doc(db,APPROVAL),{enabled:false}));
    await assertFails(deleteDoc(doc(db,APPROVAL)));
  }
});

test('a self-approval plus agenda-write batch fails atomically', async () => {
  const uid='self-approve-uid',email='self-approve@example.test',base=`accounts/${uid}/workspaces/main`,db=context(uid,{email,email_verified:true}),batch=writeBatch(db);
  batch.set(doc(db,`salonAccess/${email}`),{enabled:true});batch.set(doc(db,base),rootData());
  await assertFails(batch.commit());
  await environment.withSecurityRulesDisabled(async admin=>{
    assert.equal((await getDoc(doc(admin.firestore(),`salonAccess/${email}`))).exists(),false);
    assert.equal((await getDoc(doc(admin.firestore(),base))).exists(),false);
  });
});

test('revoking and restoring approval retains the original owner root and every protocol document', async () => {
  await seed();
  await environment.withSecurityRulesDisabled(admin=>updateDoc(doc(admin.firestore(),APPROVAL),{enabled:false}));
  for(const [name,data]of documents()){
    await assertFails(getDoc(doc(owner(),name)));
    await assertFails(setDoc(doc(owner(),name),data));
  }
  await environment.withSecurityRulesDisabled(async admin=>{
    for(const [name,data]of documents())assert.deepEqual((await getDoc(doc(admin.firestore(),name))).data(),data);
    await updateDoc(doc(admin.firestore(),APPROVAL),{enabled:true});
  });
  for(const [name,data]of documents())assert.deepEqual((await assertSucceeds(getDoc(doc(owner(),name)))).data(),data);
});

test('there is no special-case MAC bypass if its administrator approval is missing', async () => {
  await seed();await environment.withSecurityRulesDisabled(admin=>deleteDoc(doc(admin.firestore(),APPROVAL)));
  for(const [name,data]of documents()){
    await assertFails(getDoc(doc(owner(),name)));
    await assertFails(setDoc(doc(owner(),name),data));
  }
});

test('missing, nonstring, empty, oversized and slash-containing approval emails fail closed', async () => {
  for(const email of [null,17,'','a'.repeat(255),'part/segment@example.test']){
    const db=context(UID,{email,email_verified:true});
    await assertFails(getDoc(doc(db,ROOT)));await assertFails(setDoc(doc(db,ROOT),rootData()));
  }
  const missing=context(UID,{email_verified:true});
  await assertFails(getDoc(doc(missing,ROOT)));await assertFails(setDoc(doc(missing,ROOT),rootData()));
});
