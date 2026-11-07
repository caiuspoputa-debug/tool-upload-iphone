'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const assets=path.resolve(__dirname,'../docs');
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.attributes={};this.style={};this.isConnected=true;this.hidden=false;}
 append(...children){for(const child of children){this.children.push(child);if(typeof child==='object')child.parent=this;}}
 setAttribute(name,value){this.attributes[name]=value;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.isConnected=false;}
}
const walk=node=>[node,...(node.children||[]).flatMap(child=>typeof child==='object'?walk(child):[])];
const flush=async()=>{for(let n=0;n<10;n++)await new Promise(resolve=>setImmediate(resolve));};
async function harness({mode='native',connected=true,local,backend}={}){
 const state={version:1,clients:[{id:'local-client',name:'Client local'}],appointments:[],services:[]};
 local=local||new Map([['business.fixture',JSON.stringify(state)],['firebase.fixture','session-untouched'],['agenda.drive.direct.v1',JSON.stringify({auto:true,pending:false,md5:null,lastHash:createHash('sha256').update(JSON.stringify(state)).digest('hex')})]]);
 const durable=backend||{connected};const timers=new Map(),calls={authorize:[],oauth:[],requests:[],disconnect:[],revoke:[]};let timer=0,fail=null;
 const target=new EventTarget(),docEvents=new EventTarget(),body=new Element('body');
 const sandbox={navigator:{onLine:true},crypto:webcrypto,TextEncoder,Response,URL,URLSearchParams,Event,AbortSignal,queueMicrotask,
  SalonGoogleConfig:{clientId:'mock.apps.googleusercontent.com',expectedEmail:'macsocietysrl@gmail.com'},SalonCore:{validateState:value=>value},
  document:{body,hidden:false,createElement:tag=>new Element(tag),createTextNode:text=>text,addEventListener:(...args)=>docEvents.addEventListener(...args)},
  localStorage:{getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)},
  addEventListener:(...args)=>target.addEventListener(...args),dispatchEvent:event=>target.dispatchEvent(event),confirm:()=>true,
  setTimeout:(callback,delay)=>{const id=++timer;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>++timer,
  google:mode==='web'?{accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:options=>({requestAccessToken:()=>calls.oauth.push(options)}),revoke:token=>calls.revoke.push(token)}}}:undefined
 };
 function result(url){calls.requests.push(url);if(fail==='network')throw Error('transport');if(fail==='revoked')return {status:401,body:'{}'};return {status:200,body:JSON.stringify(url.includes('/userinfo')?{sub:'owner',email:'macsocietysrl@gmail.com',email_verified:true}:{files:[]})};}
 sandbox.fetch=async url=>{const value=result(url);return new Response(value.body,{status:value.status});};
 if(mode==='native')sandbox.GoogleDriveNative={session:()=>JSON.stringify({connected:durable.connected,email:'macsocietysrl@gmail.com',sub:'owner'}),isOnline:()=>sandbox.navigator.onLine,
  authorize:id=>calls.authorize.push(id),disconnect:id=>calls.disconnect.push(id),request:(id,url)=>queueMicrotask(()=>{if(fail==='revoked'){durable.connected=false;sandbox.SalonGoogleNativeResult(id,{error:'Google a retras autorizarea.',code:'reconnect_required'});return;}try{sandbox.SalonGoogleNativeResult(id,result(url));}catch(_){sandbox.SalonGoogleNativeResult(id,{error:'Rețeaua nu răspunde.'});}})};
 sandbox.window=sandbox;vm.createContext(sandbox);for(const name of ['direct-drive.js','cloud-backup.js'])vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),sandbox,{filename:name});
 await sandbox.SalonCloud.start({getState:()=>JSON.parse(local.get('business.fixture')),canBackup:()=>true,validate:value=>value,restore:()=>true,clearDraft(){}});await flush();
 const prompt=()=>body.children.find(node=>node.className==='card cloud-reconnect-notice');
 return {sandbox,local,backend:durable,calls,timers,prompt,noticeButton:label=>walk(prompt()||{}).find(node=>node.tag==='button'&&node.textContent===label),
  failure:value=>{fail=value;},async check(){await sandbox.SalonDrive.status().catch(()=>{});await flush();},
  async authorize(){if(mode==='native'){durable.connected=true;sandbox.SalonGoogleNativeResult(calls.authorize.shift(),{sub:'owner',email:'macsocietysrl@gmail.com'});}else calls.oauth.shift().callback({access_token:'SECRET-ACCESS-TOKEN',expires_in:3600});await flush();},
  async connect(){const pending=sandbox.SalonDrive.connect();await this.authorize();await pending;},
  async expire(){const entry=[...timers].find(([,value])=>value.delay>3539000&&value.delay<=3540000);assert.ok(entry,'web grant expiry timer exists');timers.delete(entry[0]);entry[1].callback();await flush();},
  async offline(value=true){sandbox.navigator.onLine=!value;sandbox.dispatchEvent(new Event(value?'offline':'online'));await flush();},
  async disconnect(){const pending=sandbox.SalonDrive.disconnect();if(mode==='native'){durable.connected=false;sandbox.SalonGoogleNativeResult(calls.disconnect.shift(),{ok:true});}await pending;await flush();},
  async refresh(){sandbox.dispatchEvent(new Event('salon-storage-committed'));docEvents.dispatchEvent(new Event('visibilitychange'));await flush();}
 };
}

test('native restored authorization and automatic token renewal do not ask for login',async()=>{
 const h=await harness();await h.check();await h.refresh();assert.equal(h.sandbox.SalonDrive.connected(),true);assert.equal(h.prompt(),undefined);assert.equal(h.calls.authorize.length,0);assert.ok(![...h.timers.values()].some(value=>value.delay===3540000),'native access-token expiry belongs to the refresh manager');
});
test('native actual revoked authorization displays an accessible notice outside Settings and preserves data',async()=>{
 const h=await harness(),business=h.local.get('business.fixture');h.failure('revoked');await h.check();
 assert.equal(h.sandbox.SalonDrive.connected(),false);assert.equal(h.prompt().attributes.role,'alert');assert.match(walk(h.prompt()).map(n=>n.textContent).join(' '),/Autorizarea Google Drive a expirat/);assert.equal(h.prompt().hidden,false);assert.ok(h.noticeButton('Mai târziu'));assert.equal(h.calls.authorize.length,0);assert.equal(h.local.get('business.fixture'),business);assert.equal(h.local.get('firebase.fixture'),'session-untouched');
});
test('dismissal is remembered for that expired grant through renders, events, and reload',async()=>{
 const h=await harness();h.failure('revoked');await h.check();h.noticeButton('Mai târziu').onclick();await h.refresh();assert.equal(h.prompt(),undefined);
 const reloaded=await harness({local:h.local,backend:h.backend});await reloaded.refresh();assert.equal(reloaded.prompt(),undefined);assert.equal(reloaded.calls.authorize.length,0);
});
test('notice reconnect is an explicit synchronous user action and a later revoked grant is a new notice',async()=>{
 const h=await harness();h.failure('revoked');await h.check();const old=h.sandbox.SalonDrive.reconnectNotice(),action=h.noticeButton('Reconectează Google Drive');h.failure(null);
 const pending=action.onclick();assert.equal(h.calls.authorize.length,1,'native authorization starts during this click');assert.equal(action.disabled,true);await h.authorize();await pending;assert.equal(h.prompt(),undefined);assert.equal(h.sandbox.SalonDrive.connected(),true);
 h.failure('revoked');await h.check();assert.ok(h.prompt());assert.notEqual(h.sandbox.SalonDrive.reconnectNotice(),old);
});
test('iPhone grant expiry shows one notice without an automatic popup; reconnect needs a tap',async()=>{
 const h=await harness({mode:'web'});await h.connect();assert.equal(h.prompt(),undefined);await h.expire();assert.ok(h.prompt());assert.equal(h.calls.oauth.length,0);
 await h.refresh();const same=h.prompt();await h.refresh();assert.equal(h.prompt(),same,'refresh does not recreate or repeatedly announce the notice');
 const pending=h.noticeButton('Reconectează Google Drive').onclick();assert.equal(h.calls.oauth.length,1,'GIS popup request remains inside the click');await h.authorize();await pending;assert.equal(h.prompt(),undefined);await h.expire();assert.ok(h.prompt());
});
test('offline does not expire authorization or open a notice; a known expiry waits for connectivity',async()=>{
 const native=await harness();await native.offline();await native.check();assert.equal(native.sandbox.SalonDrive.connected(),true);assert.equal(native.prompt(),undefined);assert.equal(native.calls.authorize.length,0);
 const web=await harness({mode:'web'});await web.connect();await web.offline();await web.expire();assert.equal(web.prompt().hidden,true);assert.equal(web.calls.oauth.length,0);await web.offline(false);assert.equal(web.prompt().hidden,false);assert.equal(web.calls.oauth.length,0);
});
for(const mode of ['native','web'])test(`${mode}: explicit signout clears reconnect state and never creates an expiry notice`,async()=>{
 const h=await harness({mode});if(mode==='web')await h.connect();await h.disconnect();await h.refresh();assert.equal(h.prompt(),undefined);assert.equal(h.local.has('agenda.drive.reconnect.v1'),false);const reloaded=await harness({mode,local:h.local,backend:h.backend});assert.equal(reloaded.prompt(),undefined);
});
for(const mode of ['native','web'])test(`${mode}: never-connected and transient failures cannot be mislabeled as expired authorization`,async()=>{
 const empty=await harness({mode,connected:false});await empty.sandbox.SalonDrive.request('https://www.googleapis.com/drive/v3/files').catch(()=>{});assert.equal(empty.prompt(),undefined);
 const h=await harness({mode});if(mode==='web')await h.connect();h.failure('network');await h.check();assert.equal(h.sandbox.SalonDrive.connected(),true);assert.equal(h.prompt(),undefined);
});
test('iPhone revoked token (401) prompts and a page reload preserves dismissal without persisting credentials',async()=>{
 const h=await harness({mode:'web'});await h.connect();h.failure('revoked');await h.check();assert.ok(h.prompt());h.noticeButton('Mai târziu').onclick();
 const marker=JSON.parse(h.local.get('agenda.drive.reconnect.v1'));assert.deepEqual(Object.keys(marker).sort(),['dismissed','id','needed']);assert.ok(!JSON.stringify([...h.local.values()]).includes('SECRET-ACCESS-TOKEN'));assert.ok(!JSON.stringify(marker).includes('@'));
 const reload=await harness({mode:'web',local:h.local});assert.equal(reload.prompt(),undefined);assert.equal(reload.calls.oauth.length,0);
});
test('iPhone losing its memory-only authorization at relaunch prompts once for that grant',async()=>{
 const h=await harness({mode:'web'});await h.connect();const reload=await harness({mode:'web',local:h.local});assert.ok(reload.prompt());assert.equal(reload.calls.oauth.length,0);reload.noticeButton('Mai târziu').onclick();const again=await harness({mode:'web',local:h.local});assert.equal(again.prompt(),undefined);
});
