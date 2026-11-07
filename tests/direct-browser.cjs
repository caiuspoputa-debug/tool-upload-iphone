const assert=require('assert/strict'),{createHash}=require('crypto'),{chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const {createActivationFixture}=require('./activation-fixture.cjs');
(async()=>{
 const activation=await createActivationFixture();
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,target=path.join(__dirname,'../docs',name==='/'?'index.html':name);fs.readFile(target,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png'})[path.extname(target)]||'text/plain'});res.end(e?'missing':activation.asset(name,data));});});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
 let file=null,body='',fail=false,uploads=0;const errors=[];
 async function context(){
  const c=await browser.newContext({viewport:{width:390,height:844}});
  await activation.seed(c);
  await c.addInitScript(()=>{window.__oauth=0;window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,revoke:(_,cb)=>cb(),initTokenClient:o=>({requestAccessToken:()=>{window.__oauth++;o.callback({access_token:'mock-token',expires_in:3600});}})}}};});
  await c.route('**/google-config.js',r=>r.fulfill({contentType:'application/javascript',body:"window.SalonGoogleConfig={clientId:'test.apps.googleusercontent.com'};"}));
  await c.route('https://www.googleapis.com/**',async r=>{
   const req=r.request(),url=new URL(req.url());assert.equal(req.headers().authorization,'Bearer mock-token');
   if(url.pathname==='/oauth2/v3/userinfo')return r.fulfill({json:{sub:'owner',email:'owner@example.test',email_verified:true}});
   if(url.pathname==='/drive/v3/files')return r.fulfill({json:{files:file?[file]:[]}});
   if(url.searchParams.get('alt')==='media')return r.fulfill({contentType:'application/json',body});
   if(url.pathname.startsWith('/upload/drive/v3/files')){
    if(req.method()==='PUT'){if(fail)return r.fulfill({status:503,json:{error:'test outage'}});body=req.postData();uploads++;file={id:'mock-file',md5Checksum:createHash('md5').update(body).digest('hex'),modifiedTime:new Date().toISOString(),size:String(body.length)};return r.fulfill({json:file});}
    return r.fulfill({status:200,headers:{Location:'https://www.googleapis.com/upload/drive/v3/files/mock-session','Access-Control-Expose-Headers':'Location'},json:{}});
   }throw Error('Unexpected request '+url);
  });return c;
 }
 const c=await context(),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date()});
 const button=name=>p.getByRole('button',{name,exact:true});
 const settled=()=>p.waitForFunction(()=>!SalonCloud.isBusy()&&!document.querySelector('.cloud-backup')?.textContent.includes('Se verifică'));
 async function settings(){await button('Setări').click();await p.locator('.cloud-backup').waitFor();}
 async function add(name,phone){await button('Clienți').click();await button('Adaugă client').click();await p.getByLabel('Nume client *',{exact:true}).fill(name);await p.getByLabel('Telefon · opțional',{exact:true}).fill(phone);await button('Salvează clientul').click();await p.waitForFunction(()=>!SalonAppLifecycle.isBusy()&&!document.querySelector('#modal-root').firstChild);}
 await p.goto(base);await p.waitForSelector('.shell');await p.waitForFunction(()=>SalonPWA.status().offlineReady);assert.equal(await p.evaluate(()=>window.__oauth),0);console.log('PASS local boot and complete offline shell without login/backend');
 await add('Client direct','0722123456');await settings();await button('Conectează Google Drive').click();await p.waitForFunction(()=>document.querySelector('.cloud-backup').textContent.includes('owner@example.test'));await settled();
 await p.clock.fastForward(59000);assert.equal(uploads,0);await p.clock.fastForward(1500);await settled();await p.clock.fastForward(1100);await p.waitForFunction(()=>JSON.parse(localStorage.getItem('agenda.drive.direct.v2.owner')).pending===false);assert.equal(uploads,1);assert.equal(JSON.parse(body).clients.length,1);console.log('PASS direct authorization and automatic backup after one minute');
 const old=body;fail=true;await add('Client nou','0722123457');await settings();await button('Fă backup acum').click();await settled();assert.equal(body,old);fail=false;await button('Fă backup acum').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('agenda.drive.direct.v2.owner')).pending===false);assert.equal(JSON.parse(body).clients.length,2);console.log('PASS upload failure preserves old file and retry updates it');
 await p.clock.fastForward(3600000);await settled();assert.equal(await p.evaluate(()=>window.__oauth),1);assert.equal(await p.locator('.shell').count(),1);console.log('PASS authorization expiry does not open a popup or lock the agenda');
 await c.setOffline(true);await p.reload();await p.waitForSelector('.shell');assert.equal(await p.evaluate(()=>SalonStorage.readBundle().state.clients.length),2);console.log('PASS offline relaunch retains local clients');await c.close();
 const fresh=await context(),q=await fresh.newPage();q.on('pageerror',e=>errors.push(e.message));await q.goto(base);await q.waitForSelector('.shell');await q.getByRole('button',{name:'Setări',exact:true}).click();await q.getByRole('button',{name:'Conectează Google Drive',exact:true}).click();await q.getByText('Există un backup în Drive. Alege restaurarea sau confirmă înlocuirea lui.',{exact:true}).waitFor();const before=uploads;assert.equal(await q.evaluate(()=>SalonStorage.readBundle().state.clients.length),0);await q.getByRole('button',{name:'Restaurează din Google Drive',exact:true}).click();await q.getByRole('button',{name:'Importă și înlocuiește',exact:true}).click();await q.waitForFunction(()=>SalonStorage.readBundle().state.clients.length===2);assert.equal(uploads,before);assert.deepEqual(errors,[]);activation.assertNoServiceRequests();console.log('PASS fresh install protects existing file and restores after confirmation');await fresh.close();await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
