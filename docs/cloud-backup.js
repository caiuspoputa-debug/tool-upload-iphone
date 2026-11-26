(function(g){
 'use strict';
 let hooks=null,prefs=null,timer=null,busy=false,statusBusy=false,remote=null,error='',needsChoice=false,pendingRestore=null,lastChange=Date.now(),accountKey=null,accountSub=null,disconnectBusy=false,disconnectFailed=false,epoch=0;
 const views=new Set();
 let reconnectPrompt=null,reconnectError='';
 const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
 const key=()=>accountKey;
 const identitySub=()=>SalonDrive.connected()?SalonDrive.identity()?.sub||null:null;
 const scope=()=>({epoch,sub:accountSub});
 const current=attempt=>!!attempt.sub&&attempt.epoch===epoch&&attempt.sub===accountSub&&attempt.sub===identitySub()&&!disconnecting();
 function readPreferences(sub){
  let raw=null;try{raw=JSON.parse(localStorage.getItem(key())||'null');}catch(_){}
  // The old unscoped setting predates support for other accounts. Only the
  // authenticated original account can inherit it; it remains untouched.
  if(!raw&&SalonDrive.identity()?.email?.toLowerCase()==='macsocietysrl@gmail.com'){
   try{const legacy=JSON.parse(localStorage.getItem('agenda.drive.direct.v1')||'null');if(legacy&&(!legacy.ownerSub||legacy.ownerSub===sub))raw=legacy;}catch(_){}
  }
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.ownerSub&&raw.ownerSub!==sub)raw={};
  return {auto:raw.auto!==false,lastHash:typeof raw.lastHash==='string'&&/^[a-f0-9]{64}$/.test(raw.lastHash)?raw.lastHash:null,md5:typeof raw.md5==='string'&&raw.md5.length<=200?raw.md5:null,lastBackup:typeof raw.lastBackup==='string'&&Number.isFinite(Date.parse(raw.lastBackup))?raw.lastBackup:null,pending:raw.pending!==false};
 }
 function bindAccount(){
  const sub=identitySub();if(sub===accountSub)return false;
  ++epoch;accountSub=sub;accountKey=sub?'agenda.drive.direct.v2.'+encodeURIComponent(sub):null;
  clearTimeout(timer);busy=false;statusBusy=false;remote=null;pendingRestore=null;needsChoice=false;error='';
  prefs=sub?readPreferences(sub):null;if(prefs)store();return true;
 }
 const element=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const cancelled=e=>e?.code==='operation_cancelled';
 const disconnecting=()=>disconnectBusy||!!SalonDrive.isDisconnecting?.();
 const button=(text,fn)=>{const n=element('button',text);n.type='button';n.className='btn secondary';n.onclick=async()=>{if(n.disabled||busy||statusBusy||disconnecting())return;const attempt=epoch;n.disabled=true;try{await fn();}catch(e){if(attempt===epoch&&!cancelled(e))error=e.message;refresh();}finally{refresh();}};return n;};
 function store(){if(!prefs||!accountKey||!accountSub)return;try{localStorage.setItem(key(),JSON.stringify({...prefs,ownerSub:accountSub}));}catch(_){error='Preferințele backupului nu au putut fi păstrate. Datele agendei nu au fost șterse.';}}
 function ready(){return hooks&&(SalonDrive.online?SalonDrive.online():navigator.onLine!==false);}
 function displayTime(value){return value?new Date(value).toLocaleString('ro-RO'):'Niciun backup confirmat';}
 function statusText(){if(disconnecting())return 'Se deconectează Google Drive…';if(error)return error;if(busy)return 'Se salvează backupul în Google Drive…';if(statusBusy)return 'Se verifică Google Drive…';if(!ready())return 'Offline · backupul va fi reluat când aplicația este deschisă și ai conexiune.';if(!SalonDrive.connected()||!remote?.connected)return 'Google Drive nu este conectat sau autorizarea a expirat. Apasă Conectează Google Drive.';if(prefs&&!prefs.auto)return prefs.pending?'Backup automat oprit · există modificări salvate doar local.':'Backup automat oprit.';if(needsChoice)return 'Există un backup în Drive. Alege restaurarea sau confirmă înlocuirea lui.';return prefs?.pending?'Backup restant · datele sunt salvate local.':'Google Drive conectat · copie curentă confirmată.';}
 function refreshReconnectPrompt(){
  const id=SalonDrive.reconnectNotice?.();
  if(!id){if(reconnectPrompt){reconnectPrompt.root.remove();reconnectPrompt=null;}reconnectError='';return;}
  if(!hooks||!document.body)return;
  if(reconnectPrompt&&reconnectPrompt.id!==id){reconnectPrompt.root.remove();reconnectPrompt=null;reconnectError='';}
  if(!reconnectPrompt){
   // A non-modal notice stays visible outside Settings without interrupting a
   // client form. Google opens only from the explicit reconnect button below.
   const root=element('section');root.className='card cloud-reconnect-notice';root.setAttribute('role','alert');root.setAttribute('aria-label','Google Drive necesită reconectare');
   root.style.cssText='position:fixed;z-index:45;left:12px;right:12px;bottom:calc(82px + env(safe-area-inset-bottom,0px));max-width:480px;max-height:calc(100vh - 120px);overflow-y:auto;margin:0 auto;padding:18px;border:2px solid var(--brand,#315b70);color:var(--ink,#192630);background:var(--panel,#fff);box-shadow:0 6px 28px #0004;';
   const title=element('h3','Reconectează Google Drive'),message=element('p','Autorizarea Google Drive a expirat sau a fost retrasă. Reconectează contul pentru a relua backupul. Agenda și datele locale sunt păstrate.'),feedback=element('p');message.className=feedback.className='setting-desc';feedback.setAttribute('role','status');feedback.hidden=true;
   const actions=element('div');actions.style.cssText='display:flex;flex-wrap:wrap;gap:8px;';
   const reconnect=element('button','Reconectează Google Drive'),dismiss=element('button','Mai târziu');
   for(const n of [reconnect,dismiss]){n.type='button';n.className='btn secondary';n.style.cssText='min-height:44px;white-space:normal;';}
   reconnect.onclick=async()=>{if(reconnect.disabled)return;reconnectError='';try{await connect();}catch(e){if(!cancelled(e))reconnectError=e.message;}finally{refresh();}};
   dismiss.onclick=()=>{SalonDrive.dismissReconnect?.();refresh();};
   actions.append(reconnect,dismiss);root.append(title,message,feedback,actions);document.body.append(root);reconnectPrompt={id,root,reconnect,feedback};
  }
  const prompt=reconnectPrompt;prompt.root.hidden=!ready()||disconnecting();prompt.reconnect.disabled=busy||statusBusy||disconnecting()||!!SalonDrive.isConnecting?.()||!ready();
  prompt.reconnect.textContent=SalonDrive.isConnecting?.()?'Conectare în curs…':'Reconectează Google Drive';
  if(prompt.feedback.textContent!==reconnectError)prompt.feedback.textContent=reconnectError;prompt.feedback.hidden=!reconnectError;
 }
 function refresh(){bindAccount();const pending=disconnecting();for(const view of [...views]){if(!view.root.isConnected&&view.seen){views.delete(view);continue;}if(view.root.isConnected)view.seen=true;view.status.textContent=statusText();view.who.textContent=SalonDrive.identity()?.email||'Agenda funcționează local, fără conectare obligatorie.';view.last.textContent='Ultimul backup: '+displayTime(remote?.modifiedAt||prefs?.lastBackup);view.auto.checked=prefs?.auto??true;view.auto.disabled=!prefs||busy||pending||disconnectFailed;view.connect.disabled=busy||statusBusy||pending||!ready()||SalonDrive.connected()||SalonDrive.isConnecting?.();view.connect.textContent=pending?'Se deconectează…':SalonDrive.connected()?'Google Drive conectat':'Conectează Google Drive';view.save.disabled=busy||statusBusy||pending||disconnectFailed||!ready()||!SalonDrive.connected()||!remote?.connected;view.restore.disabled=view.save.disabled||!remote?.hasBackup;view.disconnect.disabled=busy||statusBusy||pending||!(SalonDrive.canDisconnect?SalonDrive.canDisconnect():SalonDrive.connected());view.disconnect.textContent=pending?'Se deconectează…':'Deconectează Google Drive';}refreshReconnectPrompt();}
 async function refreshStatus(){
  bindAccount();if(!prefs||statusBusy||busy||disconnecting()||disconnectFailed||!ready()){refresh();return;}const attempt=scope();statusBusy=true;refresh();
  try{const result=await SalonDrive.status();if(!current(attempt))return;remote=result;error='';if(remote.hasBackup&&prefs.md5!==remote.md5)needsChoice=true;else if(!remote.hasBackup)needsChoice=false;}
  catch(e){if(current(attempt)&&!cancelled(e))error=e.message;}
  finally{if(current(attempt))statusBusy=false;refresh();}
 }
 function schedule(delay=60000){clearTimeout(timer);const attempt=scope();if(prefs?.auto&&!disconnecting()&&!disconnectFailed)timer=setTimeout(async()=>{if(!current(attempt))return;if(statusBusy){schedule(1000);return;}await backup(false);},delay);}
 async function committed(){
  bindAccount();if(!prefs||!hooks)return;const attempt=scope();lastChange=Date.now();
  const saved=hooks.getState();if(!saved){prefs.pending=true;error='Salvarea locală nu este confirmată. Reîncearcă salvarea înainte de backup.';store();refresh();return;}
  const fingerprint=await hash(JSON.stringify(saved));if(!current(attempt))return;
  if(pendingRestore&&fingerprint===pendingRestore.localHash){prefs.md5=pendingRestore.md5;prefs.lastHash=fingerprint;prefs.lastBackup=pendingRestore.modifiedAt;prefs.pending=false;pendingRestore=null;needsChoice=false;store();refresh();return;}
  prefs.pending=fingerprint!==prefs.lastHash;store();refresh();if(prefs.pending)schedule();
 }
 async function backup(manual){
  bindAccount();if(!prefs||busy||statusBusy||disconnecting()||disconnectFailed||!hooks)return;const attempt=scope();
  if(!ready()){prefs.pending=true;store();refresh();return;}
  if(!manual&&!prefs.auto)return;
  if(!hooks.canBackup()){if(!manual)schedule(10000);else error='Închide formularul și termină salvarea locală înainte de backup.';refresh();return;}
  const saved=hooks.getState();if(!saved){error='Salvează întâi datele local.';refresh();return;}
  busy=true;error='';refresh();
  try{
   const snapshot=JSON.stringify(saved),fingerprint=await hash(snapshot);if(!current(attempt))return;
   if(!manual&&fingerprint===prefs.lastHash){prefs.pending=false;store();return;}
   if(!remote?.connected)return;
   if(needsChoice){
    if(!manual)return;
    if(!g.confirm('Backupul existent din Google Drive va fi înlocuit cu agenda de pe acest dispozitiv. Poți restaura mai întâi copia existentă. Continui cu înlocuirea?'))return;
    if(!current(attempt))return;prefs.md5=remote.md5;store();
   }
   const result=await SalonDrive.backup(snapshot,prefs.md5||null);if(!current(attempt))return;
   prefs.md5=result.md5;prefs.lastHash=fingerprint;prefs.lastBackup=result.modifiedAt;remote={connected:true,hasBackup:true,md5:result.md5,modifiedAt:result.modifiedAt};needsChoice=false;
   const currentHash=await hash(JSON.stringify(hooks.getState()));if(!current(attempt))return;prefs.pending=currentHash!==fingerprint;store();if(prefs.pending)schedule();
  }catch(e){if(current(attempt)&&!cancelled(e)){error=e.message;prefs.pending=true;if(e.code==='remote_changed'){needsChoice=true;setTimeout(()=>{if(current(attempt))refreshStatus();},100);}store();}}
  finally{if(current(attempt))busy=false;refresh();}
 }
 async function connect(){
  if(!hooks.canBackup())throw Error('Închide formularul și salvează modificările înainte de conectare.');
  const user=await SalonDrive.connect();bindAccount();if(!user?.sub||user.sub!==accountSub||disconnecting())return;
  const attempt=scope();disconnectFailed=false;remote=null;needsChoice=false;error='';await refreshStatus();if(!current(attempt))return;await committed();if(current(attempt)&&prefs.pending)schedule();refresh();
 }
 async function restore(){
  bindAccount();if(!prefs||busy||statusBusy||disconnecting()||disconnectFailed)return;
  if(!hooks.canBackup())throw Error('Închide formularul și salvează modificările înainte de restaurare.');
  const attempt=scope();busy=true;error='';refresh();
  try{const result=await SalonDrive.restore();if(!current(attempt))return;const normalized=hooks.validate(JSON.parse(result.backupJson)),localHash=await hash(JSON.stringify(normalized));if(!current(attempt))return;pendingRestore={md5:result.md5,modifiedAt:result.modifiedAt,localHash};if(!hooks.restore(result.backupJson))pendingRestore=null;}
  catch(e){if(current(attempt)&&!cancelled(e))error=e.message;}
  finally{if(current(attempt))busy=false;refresh();}
 }
 async function disconnect(){if(disconnecting())return;++epoch;disconnectBusy=true;disconnectFailed=false;statusBusy=false;clearTimeout(timer);remote={connected:false,hasBackup:false};pendingRestore=null;needsChoice=false;error='';refresh();try{await SalonDrive.disconnect();error='Google Drive a fost deconectat. Agenda locală și fișierul existent sunt păstrate.';}catch(e){disconnectFailed=true;error='Deconectarea Google Drive nu a fost finalizată. '+e.message;}finally{disconnectBusy=false;refresh();}}
 function createControls(){
  const root=element('section');root.className='card cloud-backup';
  const title=element('h2','Cont Google și backup'),who=element('p',SalonDrive.identity()?.email||'Agenda funcționează local, fără conectare obligatorie.'),status=element('p'),last=element('p'),note=element('p','Un singur fișier curent în Google Drive. Backup automat la aproximativ un minut după ultima modificare, cât timp aplicația este deschisă. Copia anterioară nu este ștearsă înaintea salvării reușite. Conectarea Android se păstrează în aplicație și accesul se reînnoiește automat; pe iPhone poate fi necesară reconectarea Google. Nu se salvează în fundal cu aplicația închisă. Alegerea altui cont Drive nu schimbă agenda locală; verifică adresa contului înainte de backup.');
  [who,status,last,note].forEach(n=>n.className='setting-desc');
  const auto=document.createElement('input');auto.type='checkbox';auto.checked=prefs?.auto??true;
  auto.onchange=()=>{prefs.auto=auto.checked;store();hooks.clearDraft();if(prefs.auto)schedule();else clearTimeout(timer);refresh();};
  const label=element('label');label.className='checkbox-line';label.append(auto,document.createTextNode('Backup automat după modificări'));
  const actions=element('div');actions.className='backup-actions';
  const connectButton=button('Conectează Google Drive',connect),save=button('Fă backup acum',()=>backup(true)),restoreButton=button('Restaurează din Google Drive',restore),disconnectButton=button('Deconectează Google Drive',disconnect);
  actions.append(connectButton,save,restoreButton,disconnectButton);root.append(title,who,status,last,label,note,actions);
  views.add({root,who,status,last,auto,connect:connectButton,save,restore:restoreButton,disconnect:disconnectButton});refresh();queueMicrotask(refresh);return root;
 }
 async function start(options){hooks=options;bindAccount();await refreshStatus();await committed();}
 g.SalonCloud={start,createControls,isBusy:()=>busy||disconnecting()};
 g.addEventListener('salon-storage-committed',()=>{committed().catch(()=>{error='Backup restant. Salvarea locală este păstrată.';refresh();});});
 g.addEventListener('offline',refresh);
 g.addEventListener('salon-drive-changed',()=>{const changed=bindAccount();if(SalonDrive.isDisconnecting?.()){statusBusy=false;remote={connected:false,hasBackup:false};pendingRestore=null;needsChoice=false;clearTimeout(timer);}else if(SalonDrive.disconnectState?.()==='complete'&&!SalonDrive.connected()){disconnectFailed=false;remote={connected:false,hasBackup:false};error='Google Drive a fost deconectat. Agenda locală și fișierul existent sunt păstrate.';}refresh();if(changed&&accountSub&&hooks&&!disconnecting())refreshStatus().then(()=>committed());});
 g.addEventListener('salon-network-changed',()=>{refresh();if(ready())refreshStatus().then(()=>schedule(1000));});
 g.addEventListener('online',()=>{refreshStatus().then(()=>schedule(1000));});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshStatus().then(()=>schedule(1000));});
 setInterval(()=>{if(!document.hidden&&prefs?.auto&&prefs.pending&&Date.now()-lastChange>=60000)refreshStatus().then(()=>backup(false));},60000);
})(window);
