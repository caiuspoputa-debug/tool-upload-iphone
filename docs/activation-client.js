(function(global){
 'use strict';
 const CONFIG={
  publicKey:{key_ops:['verify'],ext:true,kty:'EC',x:'oggj7LvMOGmHa3e2uztoNZ5hA80lPSQWwOfEpgacWjY',y:'qo6dDOvxai6DdCfjEKW4Z-4bbVsm2XVWJI2ZHmA2a7U',crv:'P-256'},
  issuer:'ro.mac.society.frizerie.activation.v1',audience:'ro.mac.society.frizerie.activation',origin:'https://agenda-frizerie-caius.peachywave5.chatgpt.site'
 };
 const RECEIPT_KEY='agenda.frizerie.activation.receipt.v1',INSTALLATION_KEY='agenda.frizerie.activation.installation.v1';
 const MAX_LIFETIME=3650*86400,MAX_RECEIPT=4096,MAX_RESPONSE=8192,REQUEST_TIMEOUT=20000;
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
 const STYLE=`.frizerie-activation-screen{box-sizing:border-box;min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) 20px max(24px,env(safe-area-inset-bottom));background:var(--bg,#eef1f3);color:var(--ink,#17252c)}.frizerie-activation-card{box-sizing:border-box;width:100%;max-width:420px;padding:28px;border:1px solid var(--line,#d3dce0);border-radius:22px;background:var(--panel,#fff);box-shadow:0 14px 44px #17252c0d;display:flex;flex-direction:column;gap:14px}.frizerie-activation-eyebrow{margin:0;font-size:12px;letter-spacing:.2em;font-weight:800;text-align:center}.frizerie-activation-card h1{font-size:28px;line-height:1.15;margin:0;text-align:center}.frizerie-activation-copy{font-size:15px;line-height:1.5;margin:0;color:var(--muted,#4d5d65)}.frizerie-activation-card label{font-size:15px;font-weight:700;margin-top:8px}.frizerie-activation-pin{box-sizing:border-box;width:100%;min-height:56px;padding:12px;border:1px solid var(--line,#d3dce0);border-radius:12px;background:#fff;color:#17252c;text-align:center;font-size:26px;letter-spacing:.3em;font-family:inherit}.frizerie-activation-pin:focus-visible,.frizerie-activation-card button:focus-visible{outline:3px solid var(--brand,#356c68);outline-offset:3px}.frizerie-activation-card button{min-height:48px;border:0;border-radius:12px;font:inherit;font-weight:700;cursor:pointer;padding:12px 16px}.frizerie-activation-submit{background:var(--brand,#356c68);color:#fff}.frizerie-activation-cancel{background:var(--soft,#eef1f3);color:inherit}.frizerie-activation-card button:disabled{opacity:.65;cursor:wait}.frizerie-activation-message{margin:0;min-height:3em;font-size:14px;line-height:1.5;overflow-wrap:anywhere}.frizerie-activation-cancel[hidden]{display:none!important}@media(max-width:360px){.frizerie-activation-card{padding:22px}.frizerie-activation-card h1{font-size:25px}}`;
 function createClient(options={}){
  const win=options.window||global,doc=options.document||win.document,crypto=options.crypto||win.crypto;
  let storage=options.storage;try{storage||=win.localStorage;}catch(_){}
  const config=options.config||CONFIG,now=options.now||(()=>Date.now()),fetcher=options.fetch||((...args)=>win.fetch(...args));
  const later=options.setTimeout||win.setTimeout.bind(win),clear=options.clearTimeout||win.clearTimeout.bind(win);
  const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});let keyPromise,verifiedReceipt='',pending;
  function read(key){try{return storage.getItem(key)||'';}catch(_){return '';}}
  function write(key,value){try{storage.setItem(key,value);return storage.getItem(key)===value;}catch(_){return false;}}
  function discardReceipt(){try{storage.removeItem(RECEIPT_KEY);}catch(_){}verifiedReceipt='';}
  function decode(value){
   if(typeof value!=='string'||!value||!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw Error('Invalid encoding');
   const base=value.replace(/-/g,'+').replace(/_/g,'/'),raw=win.atob(base+'='.repeat((4-base.length%4)%4));
   if(win.btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==value)throw Error('Invalid encoding');
   return Uint8Array.from(raw,x=>x.charCodeAt(0));
  }
  async function validReceipt(receipt,installationId=read(INSTALLATION_KEY)){
   try{
    if(!UUID.test(installationId)||typeof receipt!=='string'||receipt.length>MAX_RECEIPT||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(receipt))return null;
    const [encoded,signature]=receipt.split('.'),raw=decode(signature);if(raw.length!==64)return null;
    keyPromise||=crypto.subtle.importKey('jwk',config.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},await keyPromise,raw,encoder.encode(encoded)))return null;
    const claims=JSON.parse(decoder.decode(decode(encoded))),time=Math.floor(now()/1000);
    if(!Number.isSafeInteger(time)||time<0)return null;
    if(!claims||typeof claims!=='object'||Array.isArray(claims)||claims.v!==1||claims.iss!==config.issuer||claims.aud!==config.audience||claims.platform!=='web'||claims.installationId!==installationId||!UUID.test(claims.installationId)||!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||claims.iat<0||claims.iat>time+300||claims.exp<=time||claims.exp<=claims.iat||claims.exp-claims.iat>MAX_LIFETIME)return null;
    return claims;
   }catch(_){return null;}
  }
  function identity(){
   const existing=read(INSTALLATION_KEY);if(UUID.test(existing))return existing;
   const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
   const hex=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join(''),id=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
   if(!write(INSTALLATION_KEY,id))throw Error('LOCAL_STORAGE');return id;
  }
  function abortError(code){const error=new Error(code);error.code=code;return error;}
  async function smallJson(response,signal){
   if(signal.aborted)throw abortError('CANCELLED');
   const length=response.headers?.get?.('Content-Length');if(length&&Number(length)>MAX_RESPONSE)throw Error('RESPONSE');
   let text='';
   if(response.body?.getReader){
    const reader=response.body.getReader();let size=0;const textDecoder=new TextDecoder('utf-8',{fatal:true});
    try{while(true){const part=await reader.read();if(signal.aborted)throw abortError('CANCELLED');if(part.done)break;size+=part.value.byteLength;if(size>MAX_RESPONSE){reader.cancel().catch(()=>{});throw Error('RESPONSE');}text+=textDecoder.decode(part.value,{stream:true});}text+=textDecoder.decode();}
    finally{try{reader.releaseLock();}catch(_){}}
   }else{text=await response.text();if(encoder.encode(text).byteLength>MAX_RESPONSE)throw Error('RESPONSE');}
   return JSON.parse(text);
  }
  async function unlock(pin,installationId,controller){
   let timer,timedOut=false,abort;
   const stop=new Promise((_,reject)=>{
    abort=()=>reject(abortError(timedOut?'TIMEOUT':'CANCELLED'));
    controller.signal.addEventListener('abort',abort,{once:true});
    timer=later(()=>{timedOut=true;controller.abort();},REQUEST_TIMEOUT);
   });
   const work=(async()=>{
    const response=await fetcher(config.origin+'/api/activation/unlock',{method:'POST',mode:'cors',cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin,installationId,platform:'web'}),signal:controller.signal});
    if(controller.signal.aborted)throw abortError('CANCELLED');
    const value=await smallJson(response,controller.signal);
    if(!response.ok){const error=Error('ACTIVATION');error.code=response.status===429?'PIN_RATE_LIMIT':value?.error?.reason==='PIN_INVALID'?'PIN_INVALID':'UNAVAILABLE';throw error;}
    if(value?.activated!==true||!await validReceipt(value.receipt,installationId))throw abortError('RECEIPT');
    return value.receipt;
   })();
   try{return await Promise.race([stop,work]);}
   finally{clear(timer);controller.signal.removeEventListener('abort',abort);}
  }
  async function gate({view=doc?.getElementById('app'),signal}={}){
   if(signal?.aborted)return false;
   const stored=read(RECEIPT_KEY);if(await validReceipt(stored)){if(signal?.aborted)return false;verifiedReceipt=stored;return true;}
   discardReceipt();if(signal?.aborted)return false;
   if(!view)throw Error('Ecranul de activare nu este disponibil.');
   const make=(tag,text,props={})=>Object.assign(doc.createElement(tag),text?{textContent:text}:{},props);
   const style=make('style',STYLE),screen=make('main','',{className:'frizerie-activation-screen'}),form=make('form','',{className:'frizerie-activation-card',noValidate:true});
   const eyebrow=make('p','AGENDA FRIZERIE',{className:'frizerie-activation-eyebrow'}),title=make('h1','Activare aplicație'),intro=make('p','Introdu PIN-ul primit pentru această aplicație. Activarea se păstrează la actualizări și la redeschiderea fără internet.',{className:'frizerie-activation-copy'});
   const label=make('label','PIN de activare',{htmlFor:'frizerie-activation-pin'}),input=make('input','',{id:'frizerie-activation-pin',className:'frizerie-activation-pin',type:'password',inputMode:'numeric',autocomplete:'off',minLength:6,maxLength:6,pattern:'[0-9]{6}',required:true,spellcheck:false});
   const button=make('button','Activează aplicația',{className:'frizerie-activation-submit',type:'submit'}),cancel=make('button','Anulează verificarea',{className:'frizerie-activation-cancel',type:'button',hidden:true}),message=make('p','Prima activare necesită internet. Datele existente ale agendei sunt păstrate.',{className:'frizerie-activation-message',role:'status'});
   message.setAttribute('aria-live','polite');message.setAttribute('aria-atomic','true');input.setAttribute('aria-describedby','frizerie-activation-message');message.id='frizerie-activation-message';
   form.append(eyebrow,title,intro,label,input,button,cancel,message);screen.append(form);view.replaceChildren(style,screen);
   return await new Promise(resolve=>{
    let settled=false,sending=false,active=null;
    const busy=value=>{sending=value;input.disabled=button.disabled=value;cancel.hidden=!value;form.setAttribute('aria-busy',String(value));};
    const finish=value=>{if(settled)return;settled=true;signal?.removeEventListener('abort',aborted);active?.abort();input.value='';resolve(value);};
    const aborted=()=>{message.textContent='Activarea a fost întreruptă. Redeschide aplicația pentru a continua.';finish(false);};
    signal?.addEventListener('abort',aborted,{once:true});
    if(signal?.aborted){aborted();return;}
    cancel.addEventListener('click',()=>{input.value='';active?.abort();});
    form.addEventListener('submit',async event=>{
     event.preventDefault();if(sending||settled)return;
     const pin=input.value;input.value='';
     if(!/^[0-9]{6}$/.test(pin)){message.textContent='Introdu PIN-ul format din exact 6 cifre.';input.focus();return;}
     if(win.navigator?.onLine===false){message.textContent='Pentru prima activare este necesară conexiunea la internet.';return;}
     busy(true);message.textContent='Se verifică PIN-ul…';const controller=new AbortController();active=controller;
     try{
      const installationId=identity(),receipt=await unlock(pin,installationId,controller);
      if(settled||controller.signal.aborted||active!==controller)return;
      if(read(INSTALLATION_KEY)!==installationId)throw abortError('RECEIPT');
      if(!write(RECEIPT_KEY,receipt))throw abortError('LOCAL_STORAGE');
      verifiedReceipt=receipt;message.textContent='Aplicația a fost activată.';finish(true);
     }catch(error){
      if(settled)return;
      const messages={PIN_INVALID:'PIN incorect. Verifică cele 6 cifre și reîncearcă.',PIN_RATE_LIMIT:'Prea multe încercări. Reîncearcă peste 10 minute.',CANCELLED:'Verificarea a fost anulată. Poți încerca din nou.',TIMEOUT:'Verificarea a durat prea mult. Verifică internetul și reîncearcă.',RECEIPT:'Răspunsul de activare nu a putut fi verificat. Încearcă din nou.',LOCAL_STORAGE:'Activarea nu a putut fi salvată pe acest dispozitiv. Permite stocarea locală și reîncearcă.'};
      message.textContent=messages[error?.code||error?.message]||'Serviciul de activare nu este disponibil. Verifică internetul și reîncearcă.';
     }finally{if(active===controller)active=null;input.value='';busy(false);}
    });
   });
  }
  function ensure(options){if(!pending)pending=gate(options).finally(()=>{pending=null;});return pending;}
  return {ensure,validReceipt,headers:()=>verifiedReceipt?{'X-Frizerie-Activation':verifiedReceipt}:{}};
 }
 global.SalonActivation=createClient();
 if(typeof module!=='undefined'&&module.exports)module.exports={createClient,CONFIG,RECEIPT_KEY,INSTALLATION_KEY,MAX_LIFETIME,REQUEST_TIMEOUT};
})(typeof window!=='undefined'?window:globalThis);
