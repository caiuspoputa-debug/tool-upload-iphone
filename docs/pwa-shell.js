(function(global){
 'use strict';
 let registration=null,started=false,startPromise=null,getCanReload=()=>false,deferredInstall=null;
 let offlineReady=false,offlineAnnounced=false,applyingUpdate=false,reloadPending=false,reloaded=false;
 let persistence='unknown',persistenceBusy=false,errorText='',ownDialog=null,noticeTimer;
 const views=new Set();
 const scriptURL=new URL(document.currentScript?.src||'pwa-shell.js',location.href);
 const base=new URL('./',scriptURL);
 const standalone=()=>navigator.standalone===true||global.matchMedia?.('(display-mode: standalone)').matches===true;
 const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
 const el=(tag,attrs={},...children)=>{const node=document.createElement(tag);for(const [key,value]of Object.entries(attrs)){if(key.startsWith('on'))node.addEventListener(key.slice(2),value);else if(key==='class')node.className=value;else node.setAttribute(key,value);}children.flat().forEach(child=>{if(child!==null&&child!==undefined)node.append(child instanceof Node?child:document.createTextNode(String(child)));});return node;};
 const button=(text,action,attrs={})=>el('button',{type:'button',class:'pwa-button',onclick:action,...attrs},text);
 function canReload(){try{return !ownDialog&&getCanReload()===true;}catch(_){return false;}}
 const hasUpdate=()=>!!registration?.waiting||reloadPending;
 function notify(text){let node=document.getElementById('pwa-notice');if(!node){node=el('div',{id:'pwa-notice',class:'pwa-notice',role:'status','aria-live':'polite'});document.body.append(node);}node.textContent=text;node.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{node.hidden=true;},6000);}
 function statusText(){if(errorText)return errorText;if(offlineReady)return 'Pregătită pentru utilizare fără internet.';return 'Pregătirea utilizării fără internet este în curs.';}
 function persistenceText(){if(persistence==='granted')return 'Browserul a activat stocarea persistentă. Păstrează și backupuri separate.';if(persistence==='denied')return 'Browserul nu a confirmat stocarea persistentă. Păstrează backupuri separate.';if(persistence==='unsupported')return 'Browserul nu oferă această opțiune. Păstrează backupuri separate.';return 'Protecția stocării depinde de browser. Datele pot fi șterse din setările dispozitivului.';}
 function refresh(){
  for(const view of [...views]){if(!view.root.isConnected){views.delete(view);continue;}view.status.textContent=statusText();view.persistence.textContent=persistenceText();view.update.hidden=!hasUpdate();view.update.disabled=applyingUpdate;view.update.textContent=applyingUpdate?'Se actualizează…':'Actualizează aplicația';view.persist.disabled=persistenceBusy;}
  let dock=document.getElementById('pwa-install-button');if(!dock){dock=button('Instalare',showInstallInfo,{id:'pwa-install-button',class:'pwa-button pwa-install-button','aria-label':'Instalare Agenda Frizerie'});document.body.append(dock);}dock.hidden=standalone()||hasUpdate();
  let banner=document.getElementById('pwa-update-banner');if(!banner){banner=el('div',{id:'pwa-update-banner',class:'pwa-update-banner',role:'status'},el('span',{},'Este disponibilă o versiune nouă.'),button('Actualizează',acceptUpdate));document.body.append(banner);}banner.hidden=!hasUpdate();banner.querySelector('button').disabled=applyingUpdate;
 }
 function closeInfo(){if(!ownDialog)return;const previous=ownDialog.previous;ownDialog.node.remove();ownDialog=null;previous?.isConnected&&previous.focus();}
 function showInstallInfo(){
  closeInfo();const previous=document.activeElement;
  const text=ios()?'În Safari: Partajare → Adaugă pe ecranul principal → Adaugă. Dacă apare, păstrează „Deschide ca aplicație web” activ.':'Folosește opțiunea „Instalează aplicația” din meniul browserului sau butonul de mai jos.';
  const heading=el('h2',{id:'pwa-info-title'},'Instalare și stocare');
  const close=button('Închide',closeInfo);
  const content=el('section',{class:'pwa-dialog',role:'dialog','aria-modal':'true','aria-labelledby':'pwa-info-title'},heading,el('p',{},standalone()?'Aplicația este deschisă din pictograma instalată.':text),el('p',{},'Instalează înainte de a introduce date reale. Dacă ai lucrat deja în Safari, exportă un backup și importă-l după deschiderea din pictogramă.'),el('p',{},statusText()),el('p',{},persistenceText()),el('div',{class:'pwa-actions'},!standalone()&&deferredInstall?button('Instalează aplicația',promptInstall):null,button('Protejează stocarea locală',requestPersistence),close));
  const backdrop=el('div',{class:'pwa-dialog-backdrop',onclick:event=>{if(event.target===backdrop)closeInfo();}},content);ownDialog={node:backdrop,previous};document.body.append(backdrop);close.focus();
 }
 async function promptInstall(){if(!deferredInstall){showInstallInfo();return false;}const prompt=deferredInstall;deferredInstall=null;try{await prompt.prompt();await prompt.userChoice;closeInfo();refresh();return true;}catch(_){notify('Folosește opțiunea de instalare din meniul browserului.');return false;}}
 async function requestPersistence(){
  if(persistenceBusy)return false;if(!navigator.storage?.persist){persistence='unsupported';notify(persistenceText());refresh();return false;}
  persistenceBusy=true;refresh();try{persistence=await navigator.storage.persist()?'granted':'denied';}catch(_){persistence='denied';}finally{persistenceBusy=false;refresh();}
  notify(persistenceText());return persistence==='granted';
 }
 function reloadOnce(){if(reloaded)return true;if(!canReload()){applyingUpdate=false;reloadPending=true;refresh();notify('Închide formularul și așteaptă salvarea înainte de actualizare.');return false;}reloaded=true;location.reload();return true;}
 function acceptUpdate(){
  if(!hasUpdate()){notify('Nu există o actualizare pregătită.');return false;}
  if(!canReload()){notify('Închide formularul și așteaptă salvarea înainte de actualizare.');return false;}
  if(reloadPending)return reloadOnce();if(applyingUpdate)return false;
  applyingUpdate=true;refresh();registration.waiting.postMessage({type:'SKIP_WAITING',userApproved:true});return true;
 }
 async function readWorkerStatus(){
  const worker=registration?.active;if(!worker)return;
  try{const reply=await new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('timeout'));},5000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};worker.postMessage({type:'GET_PWA_STATUS'},[channel.port2]);});offlineReady=reply?.type==='PWA_STATUS'&&reply.offlineReady===true;if(offlineReady&&!offlineAnnounced){offlineAnnounced=true;notify('Aplicația este pregătită pentru utilizare fără internet.');}refresh();}catch(_){offlineReady=false;refresh();}
 }
 async function checkForUpdates(){if(!registration){notify('Utilizarea fără internet nu este încă pregătită.');return false;}try{await registration.update();refresh();if(!hasUpdate())notify(navigator.onLine?'Verificarea actualizărilor a fost pornită.':'Verificarea necesită internet.');return true;}catch(_){notify('Actualizările vor putea fi verificate când revine conexiunea.');return false;}}
 function createControls(){
  const status=el('p',{class:'pwa-description'},statusText()),storage=el('p',{class:'pwa-description'},persistenceText()),update=button('Actualizează aplicația',acceptUpdate),persist=button('Protejează stocarea locală',requestPersistence);
  update.hidden=!hasUpdate();persist.disabled=persistenceBusy;
  const root=el('section',{class:'card pwa-settings'},el('h2',{},'Aplicație și stocare'),status,storage,el('div',{class:'pwa-actions'},button('Instalare pe ecranul principal',showInstallInfo),persist,button('Verifică actualizările',checkForUpdates),update));views.add({root,status,persistence:storage,update,persist});return root;
 }
 function start(options={}){
  if(typeof options.getCanReload==='function')getCanReload=options.getCanReload;if(started)return startPromise;started=true;
  document.addEventListener('keydown',event=>{if(!ownDialog)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeInfo();}else if(event.key==='Tab'){const buttons=[...ownDialog.node.querySelectorAll('button:not([disabled])')],first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}},true);
  global.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;refresh();});global.addEventListener('appinstalled',()=>{deferredInstall=null;closeInfo();refresh();});
  startPromise=(async()=>{
   refresh();try{if(navigator.storage?.persisted)persistence=await navigator.storage.persisted()?'granted':'unknown';}catch(_){}
   if(!('serviceWorker'in navigator)||!global.isSecureContext){errorText='Pentru utilizarea fără internet este necesar un browser compatibil și un link HTTPS.';refresh();return false;}
   navigator.serviceWorker.addEventListener('controllerchange',()=>{if(applyingUpdate)reloadOnce();else readWorkerStatus();});
   try{registration=await navigator.serviceWorker.register(new URL('sw.js',base).href,{scope:base.pathname,updateViaCache:'none'});registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'){refresh();if(!navigator.serviceWorker.controller)navigator.serviceWorker.ready.then(()=>readWorkerStatus());}else if(worker.state==='redundant'&&!offlineReady){errorText='Utilizarea fără internet nu a putut fi pregătită. Păstrează conexiunea și reîncearcă mai târziu.';refresh();}});});refresh();await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('timeout')),15000))]);await readWorkerStatus();return offlineReady;}
   catch(_){errorText='Utilizarea fără internet nu a putut fi pregătită pe acest link. Datele locale nu au fost șterse.';refresh();return false;}
  })();return startPromise;
 }
 global.SalonPWA={start,createControls,showInstallInfo,closeInstallInfo:closeInfo,requestPersistence,acceptUpdate,checkForUpdates,status:()=>({started,offlineReady,updateAvailable:hasUpdate(),applyingUpdate,reloadPending,persistence,error:errorText})};
})(window);
