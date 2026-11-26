'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {createClient,CONFIG,RECEIPT_KEY,INSTALLATION_KEY,MAX_LIFETIME,REQUEST_TIMEOUT}=require('../docs/activation-client.js');
const encoder=new TextEncoder(),time=Date.parse('2026-11-06T12:00:00Z'),id='9aa0cab1-7514-44dd-ae52-26a86f8761f8',otherId='d89c121d-b833-4ac0-8ba4-59718c8fa927';
const pair=webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const encode=bytes=>Buffer.from(bytes).toString('base64url');
async function receipt(changes={},keys){keys||=await pair;const payload=encode(encoder.encode(JSON.stringify({v:1,iss:CONFIG.issuer,aud:CONFIG.audience,platform:'web',installationId:id,iat:Math.floor(time/1000),exp:Math.floor(time/1000)+MAX_LIFETIME,...changes})));return payload+'.'+encode(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,encoder.encode(payload)));}
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.events={};this.attrs={};this.value='';this.textContent='';}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(name,value){this.attrs[name]=value;}
 addEventListener(name,fn){this.events[name]=fn;}
 focus(){this.focused=true;}
}
const walk=node=>[node,...(node.children||[]).flatMap(walk)],tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){const end=Date.now()+2000;while(!predicate()){if(Date.now()>end)throw Error('Test condition did not settle');await tick();}}
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
async function harness(options={}){
 const keys=await pair,publicKey=await webcrypto.subtle.exportKey('jwk',keys.publicKey),store=options.store||new Map();
 const writes=[],requests=[],root=new Element('div'),timers=new Map();let seq=0;
 const storage={getItem:key=>store.get(key)||null,setItem:(key,value)=>{if(options.failStorage)throw Error('disabled');store.set(key,value);writes.push({key,value});},removeItem:key=>{store.delete(key);writes.push({key,removed:true});}};
 const doc={createElement:tag=>new Element(tag),getElementById:()=>root};
 const win={document:doc,localStorage:storage,crypto:webcrypto,atob,btoa,navigator:{onLine:options.online!==false},setTimeout,clearTimeout};
 const client=createClient({window:win,document:doc,storage,crypto:webcrypto,now:()=>time,config:{...CONFIG,publicKey},
  setTimeout:options.fakeTimers?(fn,delay)=>{const key=++seq;timers.set(key,{fn,delay});return key;}:setTimeout,
  clearTimeout:options.fakeTimers?key=>timers.delete(key):clearTimeout,
  fetch:async(url,init)=>{requests.push({url,init});return options.fetch?options.fetch(url,init):new Response(JSON.stringify({error:{reason:'PIN_INVALID'}}),{status:401});}
 });
 const find=tag=>walk(root).find(node=>node.tag===tag),ensure=opts=>client.ensure({view:root,...opts});
 return{client,store,writes,requests,root,timers,win,ensure,input:()=>find('input'),form:()=>find('form'),submit:()=>walk(root).find(node=>node.className==='frizerie-activation-submit'),cancel:()=>walk(root).find(node=>node.className==='frizerie-activation-cancel'),message:()=>walk(root).find(node=>node.className==='frizerie-activation-message'),async enter(pin){find('input').value=pin;return find('form').events.submit({preventDefault(){}});}};
}

test('real ECDSA signatures bind every receipt to trusted key and exact web identity',async()=>{
 const h=await harness();h.store.set(INSTALLATION_KEY,id);assert.equal((await h.client.validReceipt(await receipt())).installationId,id);
 for(const changes of [{v:2},{iss:'other-issuer'},{aud:'other-app'},{platform:'android'},{installationId:otherId},{iat:Math.floor(time/1000)+301},{iat:-1},{exp:Math.floor(time/1000)},{exp:Math.floor(time/1000)+MAX_LIFETIME+1},{iat:Math.floor(time/1000)+100,exp:Math.floor(time/1000)+99}])assert.equal(await h.client.validReceipt(await receipt(changes)),null,JSON.stringify(changes));
 const other=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);assert.equal(await h.client.validReceipt(await receipt({},other)),null);
 const valid=await receipt();assert.equal(await h.client.validReceipt(valid.slice(0,-1)+(valid.endsWith('A')?'B':'A')),null);assert.equal(await h.client.validReceipt(valid+'='),null);assert.equal(await h.client.validReceipt('x'.repeat(4097)),null);
});

test('a copied receipt without matching previously stored installation cannot unlock',async()=>{
 const h=await harness();assert.equal(await h.client.validReceipt(await receipt()),null);h.store.set(INSTALLATION_KEY,otherId);assert.equal(await h.client.validReceipt(await receipt()),null);h.store.set(INSTALLATION_KEY,id);assert.ok(await h.client.validReceipt(await receipt()));
});

test('valid activation survives offline reopen and update without requests or touching agenda keys',async()=>{
 const business=JSON.stringify({appointments:[{id:'existing-booking'}],logo:'unchanged'}),store=new Map([[INSTALLATION_KEY,id],[RECEIPT_KEY,await receipt()],['atelier.sync.bundle.v1',business],['agenda.drive.direct.v1','untouched']]);
 for(let pass=0;pass<2;pass++){
  const h=await harness({store,online:false,fetch:()=>{throw Error('network must not be used');}});assert.equal(await h.ensure(),true);assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);assert.equal(h.root.children.length,0);
 }
 assert.equal(store.get('atelier.sync.bundle.v1'),business);assert.equal(store.get('agenda.drive.direct.v1'),'untouched');
});

test('invalid or expired cached receipt opens gate and only removes activation receipt',async()=>{
 for(const cached of ['invalid',await receipt({exp:Math.floor(time/1000)-1})]){
  const store=new Map([[INSTALLATION_KEY,id],[RECEIPT_KEY,cached],['business-sentinel','keep']]),h=await harness({store}),signal=new AbortController();
  const pending=h.ensure({signal:signal.signal});await until(()=>h.form());assert.ok(h.form());assert.equal(h.requests.length,0);assert.equal(store.has(RECEIPT_KEY),false);assert.deepEqual(h.writes,[{key:RECEIPT_KEY,removed:true}]);assert.equal(store.get('business-sentinel'),'keep');signal.abort();assert.equal(await pending,false);
 }
});

test('manual six-digit input preserves leading zero, clears the field and saves only signed receipt and installation',async()=>{
 let h;h=await harness({fetch:async(_,init)=>{const body=JSON.parse(init.body);assert.equal(body.pin,'012345');assert.equal(typeof body.pin,'string');assert.equal(body.platform,'web');assert.match(body.installationId,/^[0-9a-f-]{36}$/);return new Response(JSON.stringify({activated:true,receipt:await receipt({installationId:body.installationId})}),{status:200});}});
 const gate=h.ensure();await tick();const sent=h.enter('012345');assert.equal(h.input().value,'');assert.equal(h.submit().disabled,true);await sent;assert.equal(await gate,true);assert.equal(h.input().value,'');
 assert.equal(h.requests.length,1);const request=h.requests[0];assert.equal(request.url,CONFIG.origin+'/api/activation/unlock');assert.equal(request.init.credentials,'omit');assert.equal(request.init.cache,'no-store');assert.equal(request.init.redirect,'error');
 assert.deepEqual([...h.store.keys()].sort(),[INSTALLATION_KEY,RECEIPT_KEY].sort());assert.ok(await h.client.validReceipt(h.store.get(RECEIPT_KEY)));assert.equal([...h.store.values()].some(value=>value==='012345'),false);
});

test('invalid input, offline attempt and storage failure cannot request activation or boot',async()=>{
 const h=await harness(),abort=new AbortController(),gate=h.ensure({signal:abort.signal});await tick();
 for(const pin of ['12345','1234567','12 345','123a45']){await h.enter(pin);assert.equal(h.input().value,'');assert.match(h.message().textContent,/exact 6 cifre/);}assert.equal(h.requests.length,0);abort.abort();assert.equal(await gate,false);
 const off=await harness({online:false}),offAbort=new AbortController(),offGate=off.ensure({signal:offAbort.signal});await tick();await off.enter('012345');assert.equal(off.requests.length,0);assert.match(off.message().textContent,/internet/);offAbort.abort();await offGate;
 const fail=await harness({failStorage:true}),failAbort=new AbortController(),failGate=fail.ensure({signal:failAbort.signal});await tick();await fail.enter('012345');assert.equal(fail.requests.length,0);assert.match(fail.message().textContent,/stocarea locală/);failAbort.abort();await failGate;
});

test('wrong PIN and rate limit are visible without opening storage or persisting a receipt',async()=>{
 for(const [status,reason,pattern]of [[401,'PIN_INVALID',/PIN incorect/],[429,'PIN_RATE_LIMIT',/10 minute/]]){
  const h=await harness({fetch:async()=>new Response(JSON.stringify({error:{reason}}),{status})}),abort=new AbortController(),gate=h.ensure({signal:abort.signal});await tick();await h.enter('012345');assert.match(h.message().textContent,pattern);assert.equal(h.input().value,'');assert.equal(h.submit().disabled,false);assert.equal(h.store.has(RECEIPT_KEY),false);abort.abort();await gate;
 }
});

test('untrusted service receipt, oversized body and failed durable receipt save cannot unlock',async()=>{
 const other=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 for(const mode of ['wrong-key','oversize','storage']){
  let h;h=await harness({fetch:async(_,init)=>{const installationId=JSON.parse(init.body).installationId;if(mode==='storage')h.win.localStorage.setItem=()=>{throw Error('read-only');};return mode==='oversize'?new Response('x'.repeat(9000),{status:200}):new Response(JSON.stringify({activated:true,receipt:await receipt({installationId},mode==='wrong-key'?other:await pair)}),{status:200});}});
  const abort=new AbortController(),gate=h.ensure({signal:abort.signal});await tick();await h.enter('012345');assert.equal(h.store.has(RECEIPT_KEY),false);assert.equal(h.submit().disabled,false);assert.match(h.message().textContent,mode==='wrong-key'?/ne putut|nu a putut fi verificat/:mode==='storage'?/salvată/:/nu este disponibil/);abort.abort();await gate;
 }
});

test('timeout is bounded even if fetch ignores abort, and a late result cannot activate',async()=>{
 const response=deferred(),h=await harness({fakeTimers:true,fetch:()=>response.promise}),abort=new AbortController(),gate=h.ensure({signal:abort.signal});await tick();const sending=h.enter('012345');await tick();
 const timer=[...h.timers.values()][0];assert.equal(timer.delay,REQUEST_TIMEOUT);timer.fn();await sending;assert.match(h.message().textContent,/prea mult/);assert.equal(h.submit().disabled,false);assert.equal(h.store.has(RECEIPT_KEY),false);
 const installationId=h.store.get(INSTALLATION_KEY);response.resolve(new Response(JSON.stringify({activated:true,receipt:await receipt({installationId})}),{status:200}));await tick();assert.equal(h.store.has(RECEIPT_KEY),false);abort.abort();await gate;
});

test('cancel and external abort clear PIN and prevent late authorization from opening agenda',async()=>{
 for(const external of [false,true]){
  const response=deferred(),h=await harness({fetch:()=>response.promise}),abort=new AbortController(),gate=h.ensure({signal:abort.signal});await tick();const sending=h.enter('012345');await tick();
  assert.equal(h.cancel().hidden,false);if(external)abort.abort();else h.cancel().events.click();await sending;assert.equal(h.input().value,'');assert.equal(h.store.has(RECEIPT_KEY),false);if(external)assert.equal(await gate,false);else assert.match(h.message().textContent,/anulată/);
  response.resolve(new Response(JSON.stringify({activated:true,receipt:await receipt({installationId:h.store.get(INSTALLATION_KEY)})}),{status:200}));await tick();assert.equal(h.store.has(RECEIPT_KEY),false);if(!external){abort.abort();await gate;}
 }
});

test('boot gate opens no database and loads no business or authentication dependencies until activation resolves',async()=>{
 const ready=deferred(),calls=[],app={textContent:''},sandbox={document:{getElementById:()=>app,createElement:()=>({}),body:{append:script=>{calls.push(script.src);queueMicrotask(()=>script.onload());}}},SalonStorage:{open:async()=>calls.push('storage'),readBundle:()=>({state:{}})},SalonPWA:{start:()=>calls.push('pwa')},SalonCloud:{start:async()=>calls.push('cloud'),isBusy:()=>false},SalonCore:{validateState:x=>x},SalonAppLifecycle:{canReload:()=>true,clearSettingsDraft(){}},SalonAppReady:Promise.resolve(),restoreBackup(){}};
 sandbox.window=sandbox;sandbox.SalonActivation={ensure:()=>ready.promise};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../docs/boot.js'),'utf8'),sandbox);await tick();assert.deepEqual(calls,[]);ready.resolve(true);await sandbox.SalonBootReady;
 const expected=['gestures.js','finance.js','pwa-storage.js','pwa-shell.js','google-config.js','direct-drive.js','sync.js','drive-journal.js','drive-sync-ui.js','vendor/firebase-app-compat.js','vendor/firebase-auth-compat.js','vendor/firebase-firestore-compat.js','firebase-config.js','firebase-account.js','firebase-transport.js','firebase-sync-ui.js','timeline.js','holidays.js','catalog.js','cloud-backup.js','legacy-logo.js','logo.js','storage','app.js','pwa','cloud'];assert.deepEqual(calls,expected);
 for(const mode of ['cancelled','missing']){const denied={...sandbox,document:{...sandbox.document,body:{append(){throw Error('must not load');}}},SalonStorage:{open(){throw Error('must not open');}},SalonActivation:mode==='missing'?undefined:{ensure:async()=>false}};denied.window=denied;vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../docs/boot.js'),'utf8'),denied);await denied.SalonBootReady;assert.equal(mode==='missing'?app.textContent.includes('activare'):true,true);}
});

test('client configuration has no private signing or PIN material and production keys are public-only',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../docs/activation-client.js'),'utf8');assert.equal(CONFIG.publicKey.kty,'EC');assert.equal(Object.hasOwn(CONFIG.publicKey,'d'),false);assert.equal(/ACTIVATION_PIN_HASH|ACTIVATION_PIN_SALT|PBKDF2|PRIVATE_JWK/.test(source),false);
 assert.equal(RECEIPT_KEY.includes('activation'),true);assert.equal(INSTALLATION_KEY.includes('activation'),true);
});
