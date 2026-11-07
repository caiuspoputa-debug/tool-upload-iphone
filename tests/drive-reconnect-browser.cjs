'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {createActivationFixture}=require('./activation-fixture.cjs');
(async()=>{
 const activation=await createActivationFixture();
 const docs=path.resolve(__dirname,'../docs'),output=process.env.FRIZERIE_SCREENSHOT||path.resolve(__dirname,'../test-results/Frizerie-5.0.4-reconectare-Drive.png');
 fs.mkdirSync(path.dirname(output),{recursive:true});
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,target=path.join(docs,name==='/'?'index.html':name);fs.readFile(target,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png'})[path.extname(target)]||'text/plain'});res.end(error?'missing':activation.asset(name,data));});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  await activation.seed(context,{now:new Date('2026-11-04T10:00:00Z').getTime()});
  page.on('pageerror',error=>errors.push(error.message));
  await context.addInitScript(()=>{window.__oauth=0;window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,revoke:(_,cb)=>cb?.(),initTokenClient:options=>({requestAccessToken:()=>{window.__oauth++;options.callback({access_token:'mock-expiring-token',expires_in:3600});}})}}};});
  await context.route('**/google-config.js',route=>route.fulfill({contentType:'application/javascript',body:"window.SalonGoogleConfig={clientId:'mock.apps.googleusercontent.com',expectedEmail:'macsocietysrl@gmail.com'};"}));
  for(const host of ['identitytoolkit.googleapis.com','securetoken.googleapis.com','firestore.googleapis.com'])await context.route('https://'+host+'/**',route=>route.abort());
  await context.route('https://www.googleapis.com/**',route=>route.fulfill({json:new URL(route.request().url()).pathname.includes('/userinfo')?{sub:'mock-owner',email:'macsocietysrl@gmail.com',email_verified:true}:{files:[]}}));
  await page.clock.install({time:new Date('2026-11-04T10:00:00Z')});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.shell');
  await page.getByRole('button',{name:'Setări',exact:true}).click();await page.getByRole('button',{name:'Conectează Google Drive',exact:true}).click();await page.waitForFunction(()=>SalonDrive.connected());
  await page.getByRole('button',{name:'Calendar',exact:true}).click();
  const before=await page.evaluate(()=>JSON.stringify(SalonStorage.readBundle().state));
  await page.clock.fastForward(3540001);
  const prompt=page.getByRole('alert',{name:'Google Drive necesită reconectare'});await prompt.waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.__oauth),1,'expiry never opens a second Google popup');
  const bounds=await prompt.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=844,'notice fits a 390px phone viewport');
  for(const label of ['Reconectează Google Drive','Mai târziu'])assert.ok((await prompt.getByRole('button',{name:label,exact:true}).boundingBox()).height>=44,'notice actions remain touch accessible');
  await page.screenshot({path:output});console.log('PASS visible 390px notice outside Settings; screenshot '+output);
  await prompt.getByRole('button',{name:'Mai târziu',exact:true}).click();assert.equal(await prompt.count(),0);
  await page.evaluate(()=>{dispatchEvent(new Event('salon-storage-committed'));dispatchEvent(new Event('online'));});await page.waitForTimeout(50);assert.equal(await prompt.count(),0);assert.equal(await page.evaluate(()=>window.__oauth),1);
  console.log('PASS dismissal survives unrelated renders/events without opening Google');
  // A user reconnect starts a new grant, so its later expiry may notify again.
  await page.getByRole('button',{name:'Setări',exact:true}).click();await page.getByRole('button',{name:'Conectează Google Drive',exact:true}).click();await page.waitForFunction(()=>SalonDrive.connected());
  await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.clock.fastForward(3540001);await prompt.waitFor({state:'visible'});
  await prompt.getByRole('button',{name:'Reconectează Google Drive',exact:true}).click();await prompt.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>SalonDrive.connected()),true);assert.equal(await page.evaluate(()=>window.__oauth),3);
  assert.equal(await page.evaluate(()=>JSON.stringify(SalonStorage.readBundle().state)),before);assert.deepEqual(errors,[]);activation.assertNoServiceRequests();
  console.log('PASS explicit notice reconnect succeeds and leaves the agenda untouched');await context.close();
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
