/* Actual frontends and local stores, synthetic activation/agenda only.
 * Migration must queue through the ordinary journal save, never rewrite its
 * genesis or business records, and must not commit a marker after failed I/O. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),{chromium}=require('playwright');
const {createActivationFixture}=require('./activation-fixture.cjs');
const same=(a,b,message)=>assert.ok(require('node:util').isDeepStrictEqual(a,b),message||'values remain equal');
const web=path.resolve(__dirname,'../docs'),native=path.resolve(__dirname,'../../frizerie-android/app/src/main/assets'),out=path.resolve(__dirname,'../../../outputs');
require(path.join(web,'app.js'));require(path.join(web,'legacy-logo.js'));const C=global.SalonCore,J=require(path.join(web,'drive-journal.js')),S=require(path.join(web,'sync.js')),legacy=global.SalonLegacyLogoData,custom='data:image/png;base64,'+fs.readFileSync(path.join(web,'icons/icon-192.png')).toString('base64');
assert.ok(C.validSalonLogo(legacy));assert.ok(C.validSalonLogo(custom));assert.notEqual(legacy,custom);
const clone=x=>JSON.parse(JSON.stringify(x)),button=(p,name)=>p.getByRole('button',{name,exact:true}),results=[];
function fixture(kind){
 if(kind==='fresh')return {state:null,device:null};
 const state=C.validateState(C.createDemo('2026-11-06'));state.demo=false;state.clients[0].notes='Synthetic customer notes';state.appointments[0].price=87;state.appointments[0].notes='Synthetic existing manual price';
 if(kind==='custom')state.settings.workspace.logoData=custom;if(kind==='explicit-empty')state.settings.workspace.logoData=null;
 const device={kind:'frizerie-firebase-local',device:'logo-migration-device',firebaseUid:'synthetic-user',paused:true,doc:{protocol:'frizerie-drive-1',workspace:'logo-migration-workspace',device:'logo-migration-device',genesis:clone(state),operations:[]},others:[],backup:{auto:true,pending:false,lastHash:'preserved-hash',lastBackup:'2026-11-05T12:30:00.000Z'},preMigrationBackup:clone(state),preservedMarker:'synthetic-existing-device'};
 if(kind==='unjoined')delete device.doc;return {state,device};
}
const snapshot=p=>p.evaluate(()=>window.Android?{state:JSON.parse(Android.load()),device:Android.loadDevice()?JSON.parse(Android.loadDevice()):null}:SalonStorage.readBundle());
async function displayed(p,expected){const image=p.locator('.salon-header-logo');assert.equal(await image.getAttribute('src'),expected||null);assert.equal(await image.isVisible(),!!expected);if(expected)assert.ok(await image.evaluate(n=>n.complete&&n.naturalWidth>0));}
async function exported(p,mode){await button(p,'Setări').click();if(mode==='android'){await button(p,'Exportă backup').click();return p.evaluate(()=>window.fixtureExport);}const download=p.waitForEvent('download');await button(p,'Exportă backup').click();return JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));}
(async()=>{
 const activation=await createActivationFixture(),server=http.createServer((req,res)=>{const u=new URL(req.url,'http://fixture'),mode=u.pathname.startsWith('/android/')?'android':'iphone',dir=mode==='android'?native:web,name=u.pathname.replace(/^\/(android|iphone)\//,'')||'index.html',target=path.resolve(dir,name);if(!target.startsWith(dir+path.sep)){res.writeHead(404).end();return;}let data;try{data=fs.readFileSync(target);}catch{}if(name==='firebase-config.js')data=Buffer.from('window.SalonFirebaseConfig={enabled:false};');if(name==='google-config.js')data=Buffer.from("window.SalonGoogleConfig={clientId:''};");if(name==='firebase-account.js')data=Buffer.from("window.SalonFirebase={configured:()=>true,ready:()=>Promise.resolve(true),connected:()=>false,user:()=>null,db:()=>null,online:()=>false,isBusy:()=>false,error:()=>'',signIn:async()=>{},signUp:async()=>{},signOut:async()=>{},verifyEmail:async()=>{},checkVerification:async()=>{},resetPassword:async()=>{}};");if(name==='pwa-storage.js'&&data)data=Buffer.from(data.toString()+"\n{const actualWrite=SalonStorage.writeBundle;SalonStorage.writeBundle=(state,device)=>localStorage.getItem('fixture.fail')==='1'&&state.settings.workspace.logoData===window.SalonLegacyLogoData?Promise.resolve(false):actualWrite(state,device);}\n");data=activation.asset(name,data);res.writeHead(data?200:404,{'Content-Type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(target)]||'text/plain','Cache-Control':'no-store'});res.end(data||'Missing');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
  for(const mode of ['android','iphone'])for(const kind of ['fresh','implicit','unjoined','custom','explicit-empty','save-failure']){
   const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',acceptDownloads:true}),initial=fixture(kind),errors=[],external=[],images=[];
   try{
    await activation.seed(context);
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base){external.push(u.origin);return route.abort();}if(route.request().resourceType()==='image')images.push(u.pathname);return route.continue();});
    await context.addInitScript(({mode,initial,failed})=>{if(!localStorage.getItem('fixture.ready')){localStorage.setItem('fixture.ready','1');localStorage.setItem('fixture.fail',failed?'1':'0');if(initial.state){if(mode==='android'){localStorage.setItem('fixture.state',JSON.stringify(initial.state));localStorage.setItem('fixture.device',JSON.stringify(initial.device));}else localStorage.setItem('atelier.sync.bundle.v1',JSON.stringify(initial));}}if(mode==='android'){window.Android={load:()=>localStorage.getItem('fixture.state'),loadDevice:()=>localStorage.getItem('fixture.device')||'',save:state=>{localStorage.setItem('fixture.state',state);return true;},saveLocal:(state,device)=>{if(localStorage.getItem('fixture.fail')==='1'&&JSON.parse(state).settings.workspace.logoData===window.SalonLegacyLogoData)return false;localStorage.setItem('fixture.state',state);localStorage.setItem('fixture.device',device);return true;},hasUpdateBackup:()=>false,exportBackup:raw=>{window.fixtureExport=JSON.parse(raw);}};window.GoogleDriveNative={isOnline:()=>false,session:()=>JSON.stringify({connected:false})};}},{mode,initial,failed:kind==='save-failure'});
    const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(12000);await p.goto(base+'/'+mode+'/');await p.locator('.shell').waitFor();let saved=await snapshot(p);
    if(kind==='fresh'){
     assert.ok(Object.hasOwn(saved.state.settings.workspace,'logoData'));assert.equal(saved.state.settings.workspace.logoData,null);await displayed(p,null);assert.ok(!JSON.stringify(saved).includes(legacy));await p.reload();await p.locator('.shell').waitFor();assert.equal((await snapshot(p)).state.settings.workspace.logoData,null);await displayed(p,null);await p.screenshot({path:path.join(out,'Frizerie-5.0.14-logo-fresh-blank-'+mode+'.png')});
    }else if(kind==='custom'||kind==='explicit-empty'){
     same(saved,initial,'explicit custom PNG or null is not migrated or rewritten');await displayed(p,kind==='custom'?custom:null);await p.reload();await p.locator('.shell').waitFor();same(await snapshot(p),initial);await displayed(p,kind==='custom'?custom:null);
    }else{
     await displayed(p,legacy);
     if(kind==='save-failure'){
      same(saved,initial,'failed migration does not rewrite business state device metadata or journal');await p.evaluate(()=>localStorage.setItem('fixture.fail','0'));await p.reload();await p.locator('.shell').waitFor();saved=await snapshot(p);await displayed(p,legacy);
     }
     const expected=clone(initial.state);expected.settings.workspace.logoData=legacy;same(saved.state,expected,'only the logo field changes in business state');same(saved.device.preMigrationBackup,initial.state,'previous backup remains byte-equivalent');for(const key of ['device','firebaseUid','paused','others','preservedMarker'])same(saved.device[key],initial.device[key]);assert.equal(saved.device.backup.pending,true);for(const key of ['auto','lastHash','lastBackup'])assert.equal(saved.device.backup[key],initial.device.backup[key]);
     if(kind!=='unjoined'){same(saved.device.doc.genesis,initial.state,'journal genesis is never rewritten');assert.equal(saved.device.doc.operations.length,1,'migration uses exactly one ordinary synchronization operation');same(saved.device.doc.operations[0].changes.map(c=>c.key),['settings']);same(S.flatten(J.replay([saved.device.doc],C.validateState).state),S.flatten(saved.state),'queued migration replays to committed local state');}
     same(await exported(p,mode),saved.state,'ordinary backup export includes the migrated visible logo and all business records');await p.reload();await p.locator('.shell').waitFor();same(await snapshot(p),saved,'reopen never duplicates the migration');await displayed(p,legacy);
    }
    same(errors,[],mode+' '+kind+': no runtime errors');same(external,[],mode+' '+kind+': no external service requests');assert.ok(!images.some(u=>u.endsWith('/frizerie-logo.png')),'no default portrait asset requested');results.push({mode,case:kind,passed:true});console.log('PASS '+mode+' '+kind+': logo display persistence and local agenda preserved');
   }finally{await context.close();}
  }
  activation.assertNoServiceRequests();fs.writeFileSync(path.join(out,'Frizerie-5.0.14-logo-migration.json'),JSON.stringify({passed:results.length,legacyPngSha256:crypto.createHash('sha256').update(Buffer.from(legacy.split(',')[1],'base64')).digest('hex'),results,limitations:['Chromium with simulated native bridge; no real Firebase endpoint, customer data or activation credential used.','Cross-device journal replay and pending-backup metadata checked locally; live cloud transport verified separately.']},null,2)+'\n');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
