'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {webcrypto}=require('node:crypto'),{chromium}=require('playwright');
const Activation=require('../docs/activation-client.js'),docs=path.resolve(__dirname,'../docs');
const encode=bytes=>Buffer.from(bytes).toString('base64url');
(async()=>{
 const signing=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),untrusted=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const publicKey=await webcrypto.subtle.exportKey('jwk',signing.publicKey),errors=[],unexpected=[],held=[],servedScripts=[];let mode='wrong',posts=0,browser;
 const server=http.createServer((request,response)=>{
  const name=new URL(request.url,'http://localhost').pathname.slice(1)||'index.html',target=path.resolve(docs,name);
  if(!target.startsWith(docs+path.sep)){response.writeHead(404);response.end();return;}
  if(name.endsWith('.js'))servedScripts.push(name);
  let bytes;
  if(name==='firebase-config.js')bytes=Buffer.from('window.SalonFirebaseConfig={enabled:false};');
  else if(name==='google-config.js')bytes=Buffer.from("window.SalonGoogleConfig={clientId:''};");
  else if(fs.existsSync(target)&&fs.statSync(target).isFile())bytes=fs.readFileSync(target);
  if(name==='activation-client.js'&&bytes)bytes=Buffer.from(bytes.toString().replace(Activation.CONFIG.publicKey.x,publicKey.x).replace(Activation.CONFIG.publicKey.y,publicKey.y));
  response.writeHead(bytes?200:404,{'Cache-Control':'no-store','Content-Type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(name)]||'text/plain'});response.end(bytes||'Missing');
 });
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
  const context=await browser.newContext({viewport:{width:320,height:844}});
  await context.addInitScript(()=>{
   window.__beforeActivation={opens:0,businessReads:0};const open=indexedDB.open.bind(indexedDB);indexedDB.open=function(...args){window.__beforeActivation.opens++;return open(...args);};
   const get=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(['atelier.sync.bundle.v1','atelier.salon.v1'].includes(key))window.__beforeActivation.businessReads++;return get.call(this,key);};
  });
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'};
   if(url.origin===Activation.CONFIG.origin&&url.pathname==='/api/activation/unlock'){
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    posts++;const body=request.postDataJSON();assert.equal(body.pin,'012345');assert.equal(body.platform,'web');assert.equal(typeof body.pin,'string');
    if(mode==='hold')return new Promise(resolve=>held.push({route,headers,resolve}));
    if(mode==='wrong')return route.fulfill({status:401,headers,json:{error:{reason:'PIN_INVALID'}}});
    if(mode==='rate')return route.fulfill({status:429,headers,json:{error:{reason:'PIN_RATE_LIMIT'}}});
    const issued=Math.floor(Date.now()/1000),payload=encode(Buffer.from(JSON.stringify({v:1,iss:Activation.CONFIG.issuer,aud:Activation.CONFIG.audience,installationId:body.installationId,platform:'web',iat:issued,exp:issued+Activation.MAX_LIFETIME}))),key=mode==='wrong-key'?untrusted:signing,signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,Buffer.from(payload));
    return route.fulfill({status:200,headers,json:{activated:true,receipt:payload+'.'+encode(signature)}});
   }
   if(url.origin===base)return route.continue();unexpected.push(request.url());return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(base);await page.locator('.frizerie-activation-card').waitFor();
  const pin=()=>page.getByLabel('PIN de activare',{exact:true}),activate=()=>page.getByRole('button',{name:'Activează aplicația',exact:true}),message=()=>page.locator('.frizerie-activation-message');
 const assertBlocked=async()=>{assert.equal(await page.locator('.shell').count(),0);assert.equal(await page.evaluate(()=>typeof window.SalonCore),'undefined');assert.equal(await page.evaluate(()=>typeof window.SalonStorage),'undefined');assert.equal(await page.evaluate(()=>typeof window.SalonFirebaseAccount),'undefined');assert.equal(await page.evaluate(()=>typeof window.SalonDrive),'undefined');assert.deepEqual(await page.evaluate(()=>Array.from(document.scripts,script=>new URL(script.src).pathname.split('/').pop()).sort()),['activation-client.js','boot.js']);assert.deepEqual([...new Set(servedScripts)].sort(),['activation-client.js','boot.js']);assert.deepEqual(await page.evaluate(()=>window.__beforeActivation),{opens:0,businessReads:0});};
  await assertBlocked();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('.frizerie-activation-card img').count(),0);
  console.log('PASS fresh mobile activation screen has no portrait or identity image; agenda script/database/legacy business keys remain untouched');
  await pin().fill('12345');await activate().click();await message().getByText('Introdu PIN-ul format din exact 6 cifre.').waitFor();assert.equal(posts,0);
  await context.setOffline(true);await pin().fill('012345');await activate().click();await message().getByText('Pentru prima activare este necesară conexiunea la internet.').waitFor();assert.equal(posts,0);await assertBlocked();await context.setOffline(false);
  for(const [next,text]of [['wrong','PIN incorect. Verifică cele 6 cifre și reîncearcă.'],['rate','Prea multe încercări. Reîncearcă peste 10 minute.'],['wrong-key','Răspunsul de activare nu a putut fi verificat. Încearcă din nou.']]){
   mode=next;await pin().fill('012345');await activate().click();await message().getByText(text,{exact:true}).waitFor();assert.equal(await pin().inputValue(),'');await assertBlocked();assert.equal(await activate().isEnabled(),true);
  }
  console.log('PASS exact6digit validation, offlinefirstactivation, wrongPIN, serverrate limit and invalid signedresponse are visible and never open the agenda');
  mode='hold';await pin().fill('012345');await activate().click();await page.getByRole('button',{name:'Anulează verificarea',exact:true}).waitFor();await page.getByRole('button',{name:'Anulează verificarea',exact:true}).click();await message().getByText('Verificarea a fost anulată. Poți încerca din nou.',{exact:true}).waitFor();await assertBlocked();
  for(const item of held.splice(0)){try{await item.route.abort();}catch(_){}item.resolve();}
  await page.clock.install();await pin().fill('012345');await activate().click();await page.waitForTimeout(100);await page.clock.fastForward(20010);await message().getByText('Verificarea a durat prea mult. Verifică internetul și reîncearcă.',{exact:true}).waitFor();await assertBlocked();await page.clock.resume();
  for(const item of held.splice(0)){try{await item.route.abort();}catch(_){}item.resolve();}
  console.log('PASS cancellation and bounded20second timeout keep PINcleared and agenda blocked');
  mode='success';await pin().fill('012345');await activate().click();await page.locator('.shell').waitFor();await page.waitForFunction(()=>SalonPWA.status().offlineReady);const requestsBeforeReopen=posts;
  assert.equal(await page.locator('.salon-header-logo:visible').count(),0,'new installation has no default portrait');
  assert.equal(await page.evaluate(()=>!!SalonStorage.readBundle().state.settings.workspace.logoData),false,'new installation stores no legacy portrait');
  const activationKeys=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('agenda.frizerie.activation.')).sort());assert.deepEqual(activationKeys,[Activation.INSTALLATION_KEY,Activation.RECEIPT_KEY].sort());
  assert.equal(await page.evaluate(()=>JSON.stringify(SalonStorage.readBundle()).includes('agenda.frizerie.activation')),false);
  await context.setOffline(true);await page.reload();await page.locator('.shell').waitFor();await page.waitForFunction(()=>SalonPWA.status().offlineReady);assert.equal(posts,requestsBeforeReopen);assert.equal(await page.locator('.frizerie-activation-card').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  console.log('PASS fresh installation remains blank-logo after realWebCrypto synthetic activation and offline reopen; no PINre-entry or servicecontact; receipt excludedfromagenda');
  await context.close();
 }finally{for(const item of held.splice(0)){try{await item.route.abort();}catch(_){}item.resolve();}if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
