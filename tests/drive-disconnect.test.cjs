'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const assets = path.resolve(__dirname, '../docs');

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.isConnected = true; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}
const walk = node => [node, ...(node.children || []).flatMap(child => typeof child === 'object' ? walk(child) : [])];
async function until(predicate) {
  const end = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > end) throw Error('Test callback did not finish'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function harness({ connected = true, recovery = false, mode = 'native', backend } = {}) {
  const state = { version: 1, demo: false, settings: {}, clients: [], appointments: [], services: [] };
  const preferences = { auto: true, pending: false, md5: 'confirmed-md5', lastHash: createHash('sha256').update(JSON.stringify(state)).digest('hex'), lastBackup: '2026-11-04T08:00:00.000Z' };
  const local = new Map([['agenda.drive.direct.v1', JSON.stringify(preferences)], ['fixture.business', JSON.stringify(state)]]), timers = new Map();
  let timerId = 0, writes = 0;
  const calls = { authorize: [], disconnect: [], requests: [], revokes: [], oauth: [] }, held = [];
  const durable = backend || { connected, recovery };
  let holdStatus = 0;
  const target = new EventTarget();
  const documentTarget = new EventTarget();
  const file = { id: 'test-backup', md5Checksum: 'confirmed-md5', modifiedTime: '2026-11-04T08:00:00.000Z', size: '100' };
  function response(url, method, complete) {
    const address = new URL(url); calls.requests.push({ url, method: method || 'GET' });
    if (address.pathname === '/oauth2/v3/userinfo') return complete({ sub: 'owner-test', email: 'macsocietysrl@gmail.com', email_verified: true });
    assert.equal(address.pathname, '/drive/v3/files', 'test never calls a real or mutating Drive endpoint');
    if (holdStatus > 0) { holdStatus--; held.push(() => complete({ files: [file] })); }
    else return complete({ files: [file] });
  }
  const sandbox = {
    navigator: { onLine: true }, crypto: webcrypto, TextEncoder, Response, URL, URLSearchParams, Event, AbortSignal,
    SalonGoogleConfig: { clientId: 'mock-client.apps.googleusercontent.com', expectedEmail: 'macsocietysrl@gmail.com' },
    SalonCore: { validateState: value => value },
    document: { hidden: false, createElement: tag => new Element(tag), createTextNode: value => value, addEventListener: (...args) => documentTarget.addEventListener(...args) },
    localStorage: { getItem: key => local.get(key) || null, setItem: (key, value) => { writes++; local.set(key, value); }, removeItem: key => local.delete(key) },
    addEventListener: (...args) => target.addEventListener(...args), dispatchEvent: event => target.dispatchEvent(event),
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id), setInterval: () => ++timerId,
    queueMicrotask, confirm: () => true,
    GoogleDriveNative: mode === 'native' ? {
      session: () => JSON.stringify({ ...durable, email: 'macsocietysrl@gmail.com', sub: 'owner-test' }),
      isOnline: () => true,
      authorize: id => calls.authorize.push(id),
      disconnect: id => calls.disconnect.push(id),
      request: (id, url, method) => durable.connected
        ? response(url, method, data => queueMicrotask(() => sandbox.SalonGoogleNativeResult(id, { status: 200, body: JSON.stringify(data) })))
        : queueMicrotask(() => sandbox.SalonGoogleNativeResult(id, { error: 'Autorizarea a fost retrasă.', code: 'reconnect_required' }))
    } : undefined,
    google: mode === 'web' ? { accounts: { oauth2: { hasGrantedAllScopes: () => true, initTokenClient: options => ({ requestAccessToken: () => calls.oauth.push(options) }), revoke: (token, callback) => { calls.revokes.push(token); queueMicrotask(() => callback?.()); } } } } : undefined,
    fetch: (url, options = {}) => new Promise(resolve => response(url, options.method, data => resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }))))
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['direct-drive.js', 'cloud-backup.js']) vm.runInContext(fs.readFileSync(path.join(assets, file), 'utf8'), sandbox, { filename: file });
  await sandbox.SalonCloud.start({ getState: () => JSON.parse(local.get('fixture.business')), canBackup: () => true, validate: value => value, restore: () => true, clearDraft() {} });
  const root = sandbox.SalonCloud.createControls();
  const button = name => walk(root).find(node => node.tag === 'button' && node.textContent === name);
  return {
    sandbox, calls, root, button, writes: () => writes, backend: durable,
    business: () => local.get('fixture.business'), preferences: () => JSON.parse(local.get('agenda.drive.direct.v2.owner-test') || local.get('agenda.drive.direct.v1')),
    holdNextStatus() { holdStatus++; }, statusHeld: () => held.length,
    releaseStatus() { for (const finish of held.splice(0)) finish(); },
    visibility() { documentTarget.dispatchEvent(new Event('visibilitychange')); },
    disconnectSuccess(clearSession = true) { if (clearSession) { durable.connected = false; durable.recovery = false; } sandbox.SalonGoogleNativeResult(calls.disconnect.shift(), { ok: true }); },
    disconnectFailure() { sandbox.SalonGoogleNativeResult(calls.disconnect.shift(), { error: 'Autorizarea nu a putut fi ștearsă din stocarea protejată.' }); },
    timeoutDisconnect() { const entry = [...timers].find(([, value]) => value.delay === 125000); assert.ok(entry, 'native disconnect timeout is scheduled'); timers.delete(entry[0]); entry[1].callback(); },
    lateAuthorizeSuccess() { sandbox.SalonGoogleNativeResult(calls.authorize.shift(), { email: 'macsocietysrl@gmail.com', sub: 'owner-test', persistent: true }); },
    authorizeSuccess() { durable.connected = true; durable.recovery = false; sandbox.SalonGoogleNativeResult(calls.authorize.shift(), { email: 'macsocietysrl@gmail.com', sub: 'owner-test', persistent: true }); },
    oauthSuccess() { calls.oauth.shift().callback({ access_token: 'fake-web-token', expires_in: 3600 }); }
  };
}

test('Drive disconnect remains visibly pending and disabled across unrelated storage refreshes', async () => {
  const h = await harness(), disconnect = h.button('Deconectează Google Drive');
  assert.ok(disconnect && !disconnect.disabled);
  const pending = disconnect.onclick();
  assert.equal(h.calls.disconnect.length, 1, 'native durable removal is pending');
  try {
    const previous = h.writes();
    h.sandbox.dispatchEvent(new Event('salon-storage-committed'));
    await Promise.resolve();
    assert.equal(h.writes(), previous, 'an unbound account cannot rewrite backup preferences during disconnect');
    assert.equal(disconnect.disabled, true, 'ordinary form saves must not re-enable a disconnect still waiting for native storage');
    assert.ok(walk(h.root).filter(node => node.tag === 'button').every(node => node.disabled), 'all Drive actions stay disabled while native disconnect is pending');
    assert.equal(walk(h.root).find(node => node.tag === 'input').disabled, true, 'automatic backup cannot be toggled during disconnect');
    const status = h.root.children[2].textContent;
    assert.match(status, /se deconectează|deconectare.*curs/i, 'pending disconnect must explain why Drive has not yet finished disconnecting');
  } finally { h.disconnectSuccess(); await pending; }
  assert.equal(h.sandbox.SalonDrive.connected(), false);
});

test('a stale authorization callback cannot reconnect JS after acknowledged native disconnect', async () => {
  // An unreadable stored credential exposes Disconnect for recovery while a
  // new authorization is still pending; a queued old reply must be ignored.
  const h = await harness({ connected: false, recovery: true });
  const authorization = h.sandbox.SalonDrive.connect().catch(() => {});
  assert.equal(h.calls.authorize.length, 1);
  const pending = h.sandbox.SalonDrive.disconnect();
  h.disconnectSuccess(); await pending;
  assert.equal(h.sandbox.SalonDrive.connected(), false);
  h.lateAuthorizeSuccess(); await authorization;
  assert.equal(h.sandbox.SalonDrive.connected(), false, 'late pre-disconnect result must not resurrect the JavaScript session');
  assert.equal(JSON.parse(h.sandbox.GoogleDriveNative.session()).connected, false, 'durable native session remains disconnected');
});

test('native durable-clear failure reports the error and preserves the actual stored session and business data', async () => {
  const h = await harness(), business = h.business(), before = h.preferences();
  const pending = h.button('Deconectează Google Drive').onclick();
  h.disconnectFailure(); await pending;
  assert.equal(h.backend.connected, true);
  assert.equal(h.sandbox.SalonDrive.connected(), true, 'failure cannot falsely claim the saved authorization was removed');
  assert.equal(h.button('Google Drive conectat').disabled, true);
  assert.equal(h.button('Deconectează Google Drive').disabled, false, 'failed clear can be retried');
  assert.match(h.root.children[2].textContent, /nu a putut fi ștearsă/);
  assert.equal(h.business(), business);
  assert.equal(h.preferences().md5, before.md5); assert.equal(h.preferences().lastBackup, before.lastBackup);
});

test('acknowledged native disconnect survives module reload and preserves local agenda and backup metadata', async () => {
  const h = await harness(), business = h.business(), before = h.preferences();
  const pending = h.button('Deconectează Google Drive').onclick(); h.disconnectSuccess(); await pending;
  assert.equal(h.business(), business); assert.equal(h.preferences().md5, before.md5); assert.equal(h.preferences().lastBackup, before.lastBackup);
  const reloaded = await harness({ backend: h.backend });
  assert.equal(reloaded.sandbox.SalonDrive.connected(), false);
  assert.equal(reloaded.button('Conectează Google Drive').disabled, false);
  assert.equal(reloaded.button('Fă backup acum').disabled, true);
  assert.equal(reloaded.calls.authorize.length, 0, 'reload never prompts for authorization');
  assert.ok(h.calls.requests.every(request => request.method === 'GET'), 'disconnect never deletes or rewrites a Drive backup');
});

test('native durable disconnect completed after the JavaScript timeout reconciles the actual session and controls', async () => {
  const h = await harness(), business = h.business();
  const pending = h.button('Deconectează Google Drive').onclick();
  h.timeoutDisconnect(); await pending;
  assert.equal(h.backend.connected, true, 'timeout by itself cannot claim the queued durable clear succeeded');
  h.disconnectSuccess();
  await until(() => h.sandbox.SalonDrive.connected() === false);
  assert.equal(h.button('Fă backup acum').disabled, true);
  assert.equal(h.button('Restaurează din Google Drive').disabled, true);
  assert.ok(h.button('Conectează Google Drive'));
  assert.equal(h.business(), business);
});

test('native clear failure arriving after timeout never falsely reports durable disconnection', async () => {
  const h = await harness(), business = h.business();
  const pending = h.button('Deconectează Google Drive').onclick();
  h.timeoutDisconnect(); await pending; h.disconnectFailure();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(h.backend.connected, true);
  assert.equal(h.sandbox.SalonDrive.connected(), true);
  assert.ok(h.button('Google Drive conectat'));
  assert.equal(h.button('Deconectează Google Drive').disabled, false);
  assert.equal(h.business(), business);
});

test('an old timed-out disconnect acknowledgement cannot clear a newer authorized session', async () => {
  const h = await harness();
  const pending = h.sandbox.SalonDrive.disconnect().catch(() => {}); h.timeoutDisconnect(); await pending;
  // The durable clear completed, but its UI callback is delayed. A subsequent
  // native request observes the now-missing authorization and enables reconnect.
  h.backend.connected = false;
  await h.sandbox.SalonDrive.request('https://www.googleapis.com/drive/v3/files').catch(() => {});
  assert.equal(h.sandbox.SalonDrive.connected(), false);
  const connecting = h.sandbox.SalonDrive.connect(); h.authorizeSuccess(); await connecting;
  assert.equal(h.sandbox.SalonDrive.connected(), true);
  h.disconnectSuccess(false);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(h.backend.connected, true, 'new native grant remains durable');
  assert.equal(h.sandbox.SalonDrive.connected(), true, 'old acknowledgement cannot invalidate newer authorization');
  assert.ok(h.button('Google Drive conectat'));
});

for (const mode of ['native', 'web']) {
  test(`${mode}: an in-flight status response cannot restore backup actions after disconnect`, async () => {
    const h = await harness({ mode, connected: mode === 'native' }), business = h.business();
    if (mode === 'web') { const connecting = h.sandbox.SalonDrive.connect(); h.oauthSuccess(); await connecting; }
    await until(() => !h.root.children[2].textContent.includes('Se verifică'));
    h.holdNextStatus(); h.visibility(); await until(() => h.statusHeld() === 1);
    const pending = h.sandbox.SalonDrive.disconnect();
    if (mode === 'native') h.disconnectSuccess();
    await pending; h.releaseStatus();
    await until(() => !h.sandbox.SalonCloud.isBusy());
    // Let the stale status continuation finish as well as its native callback.
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(h.sandbox.SalonDrive.connected(), false);
    assert.equal(h.button('Fă backup acum').disabled, true);
    assert.equal(h.button('Restaurează din Google Drive').disabled, true);
    assert.ok(h.button('Conectează Google Drive'));
    assert.equal(h.business(), business);
    if (mode === 'web') assert.deepEqual(h.calls.revokes, ['fake-web-token']);
    assert.ok(h.calls.requests.every(request => request.method === 'GET'));
  });
}

test('iPhone web GIS callback arriving after disconnect cannot reconnect or request user information', async () => {
  const h = await harness({ mode: 'web', connected: false }), business = h.business();
  const connecting = h.sandbox.SalonDrive.connect().catch(() => {});
  await h.sandbox.SalonDrive.disconnect(); h.oauthSuccess(); await connecting;
  assert.equal(h.sandbox.SalonDrive.connected(), false);
  assert.equal(h.sandbox.SalonDrive.identity(), null);
  assert.equal(h.calls.requests.filter(request => new URL(request.url).pathname === '/oauth2/v3/userinfo').length, 0, 'cancelled GIS callback cannot start user-data access');
  assert.equal(h.business(), business);
  assert.equal(h.button('Fă backup acum').disabled, true);
});
