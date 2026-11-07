(function(g){
 'use strict';
 const SCOPE='https://www.googleapis.com/auth/drive.file',API='https://www.googleapis.com/drive/v3/files',FIELDS='id,name,modifiedTime,md5Checksum,size';
 let accessToken='',expires=0,client=null,loading=null,connecting=false,identity=null,nativeConnected=false,expiryTimer=null,nativeRecovery=false,disconnecting=false,disconnectTask=null,epoch=0,cancelAuthorization=null,disconnectResult='idle';
 const nativeCalls=new Map();
 // This marker contains no credentials. It remembers a dismissed reconnect
 // notice, including when Safari loses its memory-only grant after a reload.
 const reconnectKey='agenda.drive.reconnect.v1';let reconnectState=null;
 try{const saved=JSON.parse(localStorage.getItem(reconnectKey)||'null');if(saved&&typeof saved.id==='string'&&saved.id.length<=100&&typeof saved.needed==='boolean'&&typeof saved.dismissed==='boolean')reconnectState={id:saved.id,needed:saved.needed,dismissed:saved.dismissed};}catch(_){}
 function rememberReconnect(){try{if(reconnectState)localStorage.setItem(reconnectKey,JSON.stringify(reconnectState));else localStorage.removeItem(reconnectKey);}catch(_){} }
 function authorized(){reconnectState={id:crypto.randomUUID(),needed:false,dismissed:false};rememberReconnect();}
 function requireReconnect(){if(identity||nativeConnected||reconnectState){if(!reconnectState)reconnectState={id:crypto.randomUUID(),needed:false,dismissed:false};reconnectState.needed=true;rememberReconnect();}clear();}
 function reconnectNotice(){return !disconnecting&&reconnectState?.needed&&!reconnectState.dismissed?reconnectState.id:null;}
 function dismissReconnect(){if(reconnectState?.needed){reconnectState.dismissed=true;rememberReconnect();changed();}}
 function nativeCall(action,args=[],late){return new Promise((resolve,reject)=>{const attempt=epoch,id=crypto.randomUUID();let timedOut=false;const timer=setTimeout(()=>{timedOut=true;if(!late)nativeCalls.delete(id);reject(problem('Google nu a răspuns. Reîncearcă.',action==='disconnect'?'disconnect_timeout':'native_timeout'));},action==='authorize'?660000:125000);const cancel=()=>{clearTimeout(timer);nativeCalls.delete(id);reject(cancelled());};nativeCalls.set(id,{action,cancel,done:value=>{clearTimeout(timer);if(attempt!==epoch||(action!=='disconnect'&&disconnecting)){reject(cancelled());return;}if(timedOut){late?.(value);return;}value.error?reject(problem(value.error,value.code)):resolve(value);}});try{g.GoogleDriveNative[action](id,...args);}catch(e){clearTimeout(timer);nativeCalls.delete(id);reject(e);}});}
 g.SalonGoogleNativeResult=(id,value)=>{const call=nativeCalls.get(id);if(call){nativeCalls.delete(id);call.done(value);}};
 const problem=(message,code)=>Object.assign(Error(message),{code});
 const cancelled=()=>problem('Operația Google Drive a fost oprită prin deconectare.','operation_cancelled');
 const active=attempt=>{if(attempt!==epoch||disconnecting)throw cancelled();};
 const connected=()=>!disconnecting&&!!(accessToken||nativeConnected)&&Date.now()<expires;
 const validIdentity=user=>!!user&&typeof user.sub==='string'&&/^[A-Za-z0-9_-]{1,255}$/.test(user.sub)&&typeof user.email==='string'&&user.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email);
 function changed(){g.dispatchEvent(new Event('salon-drive-changed'));}
 function expireAfter(ms){const attempt=epoch;clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>{if(attempt===epoch&&!disconnecting)requireReconnect();},Math.max(0,ms));}
 function online(){if(g.navigator?.onLine===false)return false;try{return g.GoogleDriveNative?.isOnline?g.GoogleDriveNative.isOnline()!==false:true;}catch(_){return false;}}
 function clear(){clearTimeout(expiryTimer);accessToken='';expires=0;identity=null;nativeConnected=false;changed();}
 if(g.GoogleDriveNative?.session){try{const saved=JSON.parse(g.GoogleDriveNative.session());nativeRecovery=!!saved.recovery;if(saved.connected&&validIdentity(saved)){identity={email:saved.email,sub:saved.sub};nativeConnected=true;expires=Infinity;}}catch(_){} }
 if(nativeConnected){if(!reconnectState||reconnectState.needed)authorized();}else if(!g.GoogleDriveNative&&reconnectState){reconnectState.needed=true;rememberReconnect();}
 function load(){
  if(g.GoogleDriveNative)return Promise.resolve();
  if(g.google?.accounts?.oauth2)return Promise.resolve();
  if(loading)return loading;
  loading=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=()=>resolve();s.onerror=()=>{loading=null;s.remove();reject(problem('Google nu poate fi încărcat. Verifică internetul și încearcă din nou.','google_unavailable'));};document.head.append(s);});return loading;
 }
 async function request(url,options={}){
  const attempt=epoch;active(attempt);
  if(!online())throw problem('Telefonul nu are internet. Datele rămân salvate local.','offline');
  if(!connected()){if(accessToken||nativeConnected)requireReconnect();throw problem('Apasă Conectează Google Drive pentru a autoriza din nou backupul.','reconnect_required');}
  let r;try{if(g.GoogleDriveNative){const data=await nativeCall('request',[url,options.method||'GET',JSON.stringify(options.headers||{}),options.body??null]);r=new Response(data.body||'',{status:data.status,headers:data.location?{Location:data.location}:{}});}else r=await fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer '+accessToken},cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(120000)});active(attempt);}catch(e){active(attempt);if(e.code==='operation_cancelled')throw e;if(e.code==='reconnect_required'){requireReconnect();throw e;}throw problem('Transferul către Google a eșuat. Datele locale și copia anterioară sunt păstrate.','network_error');}
  if(r.status===401){requireReconnect();throw problem('Google cere reconectare. Agenda rămâne disponibilă local.','reconnect_required');}
  if(r.status===412)throw problem('Copia din Drive s-a schimbat. Verifică și restaurează înainte de înlocuire.','remote_changed');
  if(!r.ok)throw problem('Google nu a confirmat operația. Verifică permisiunea și spațiul din Drive.','drive_error');return r;
 }
 async function remote(){
  const query=new URLSearchParams({q:"trashed=false and appProperties has { key='agendaFrizerieBackup' and value='v1' }",spaces:'drive',fields:'files('+FIELDS+'),nextPageToken',pageSize:'2'});
  const data=await(await request(API+'?'+query)).json();
  if(!Array.isArray(data.files)||data.files.length>1||data.nextPageToken)throw problem('Există mai multe copii în Drive. Verifică fișierele înainte de înlocuire.','multiple_backups');
  const file=data.files[0];if(file&&(!/^[A-Za-z0-9_-]{1,200}$/.test(file.id)||!file.md5Checksum))throw problem('Metadatele backupului nu pot fi verificate.','invalid_backup');return file||null;
 }
 const info=file=>({connected:true,hasBackup:!!file,md5:file?.md5Checksum||null,modifiedAt:file?.modifiedTime||null});
 async function status(){const attempt=epoch;if(!connected()){if(accessToken||nativeConnected)requireReconnect();return {connected:false,hasBackup:false};}const file=await remote();active(attempt);return info(file);}
 function connect(){
  if(disconnecting)return Promise.reject(problem('Deconectarea Google Drive este în curs. Așteaptă finalizarea ei.','disconnecting'));
  // This function is called directly by the user's click. No awaited network
  // operation precedes Google's popup, including on iOS Safari.
  if(!online())return Promise.reject(problem('Telefonul nu are internet. Conectarea Google nu a fost deschisă.','offline'));
  if(connected())return Promise.resolve(identity);
  if(connecting)return Promise.reject(problem('Conectarea Google este deja deschisă.','connecting'));
  if(g.GoogleDriveNative){const attempt=++epoch;disconnectResult='idle';connecting=true;changed();return nativeCall('authorize').then(user=>{active(attempt);if(!validIdentity(user))throw problem('Google nu a confirmat identitatea contului. Agenda locală este păstrată.','invalid_identity');identity={email:user.email,sub:user.sub};nativeConnected=true;expires=Infinity;clearTimeout(expiryTimer);authorized();return identity;}).finally(()=>{if(attempt===epoch){connecting=false;changed();}});}
  if(!g.google?.accounts?.oauth2){load().catch(()=>{});return Promise.reject(problem('Google se încarcă. Apasă din nou Conectează Google Drive.','loading'));}
  if(!g.SalonGoogleConfig?.clientId)return Promise.reject(problem('Administratorul trebuie să configureze identificatorul OAuth Google al aplicației.','not_configured'));
  const attempt=++epoch;disconnectResult='idle';connecting=true;changed();
  return new Promise((resolve,reject)=>{
   let settled=false;
   const fail=()=>{if(settled)return;settled=true;if(cancelAuthorization===cancel)cancelAuthorization=null;if(attempt===epoch){connecting=false;changed();}reject(attempt===epoch&&!disconnecting?problem('Conectarea Google nu a fost finalizată. Agenda locală este păstrată.','oauth_error'):cancelled());};
   const cancel=()=>fail();cancelAuthorization=cancel;
   client=g.google.accounts.oauth2.initTokenClient({client_id:g.SalonGoogleConfig.clientId,scope:SCOPE+' openid email',include_granted_scopes:false,error_callback:fail,callback:async value=>{
    if(settled||attempt!==epoch||disconnecting){fail();return;}
    if(value.error||!value.access_token||!g.google.accounts.oauth2.hasGrantedAllScopes(value,SCOPE)){fail();return;}
    accessToken=value.access_token;expires=Date.now()+Math.max(0,Number(value.expires_in||0)-60)*1000;
    try{const user=await(await request('https://www.googleapis.com/oauth2/v3/userinfo')).json();active(attempt);if(settled)return;if(!validIdentity(user)||user.email_verified!==true)throw Error('identity');identity={sub:user.sub,email:user.email};connecting=false;settled=true;if(cancelAuthorization===cancel)cancelAuthorization=null;authorized();expireAfter(expires-Date.now());changed();resolve(identity);}catch(_){if(attempt===epoch&&!disconnecting)clear();fail();}
   }});try{client.requestAccessToken({prompt:'select_account'});}catch(_){fail();}
  });
 }
 async function backup(text,expectedMd5){
  const attempt=epoch;active(attempt);
  const parsed=JSON.parse(text),normalized=g.SalonCore.validateState(parsed);text=JSON.stringify(normalized);
  if(new TextEncoder().encode(text).length>30*1024*1024)throw problem('Backupul depășește limita de 30 MB.','invalid_backup');
  const file=await remote();active(attempt);
  // A changed or pre-existing copy is never silently replaced by a new device.
  if((file?.md5Checksum||null)!==(expectedMd5||null))throw problem('Există o altă copie în Drive. Alege restaurarea sau confirmă înlocuirea.','remote_changed');
  const metadata={name:'Agenda-Frizerie-backup.json',mimeType:'application/json',appProperties:{agendaFrizerieBackup:'v1'}};
  const start=await request('https://www.googleapis.com/upload/drive/v3/files'+(file?'/'+file.id:'')+'?'+new URLSearchParams({uploadType:'resumable',fields:FIELDS}),{method:file?'PATCH':'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/json'},body:JSON.stringify(metadata)});active(attempt);
  const location=start.headers.get('Location');let target;try{target=new URL(location);}catch(_){throw problem('Google nu a confirmat adresa de transfer.','upload_error');}
  if(target.origin!=='https://www.googleapis.com'||!target.pathname.startsWith('/upload/drive/v3/files'))throw problem('Adresa de transfer Google nu este validă.','upload_error');
  const result=await(await request(target.href,{method:'PUT',headers:{'Content-Type':'application/json'},body:text})).json();
  active(attempt);if(!result.md5Checksum||!result.modifiedTime)throw problem('Google nu a confirmat salvarea. Verifică din nou copia înainte de reîncercare.','upload_error');return info(result);
 }
 async function restore(){const attempt=epoch;active(attempt);const file=await remote();active(attempt);if(!file)throw problem('Nu există un backup în acest cont Drive.','no_backup');if(Number(file.size)>30*1024*1024)throw problem('Backupul este prea mare.','invalid_backup');const text=await(await request(API+'/'+file.id+'?alt=media')).text();active(attempt);g.SalonCore.validateState(JSON.parse(text));return {...info(file),backupJson:text};}
 function disconnect(){
  if(disconnectTask)return disconnectTask;
   const token=accessToken;disconnecting=true;disconnectResult='pending';const attempt=++epoch;connecting=false;
  cancelAuthorization?.();cancelAuthorization=null;
   for(const call of [...nativeCalls.values()])call.cancel();
   const confirmed=()=>{if(attempt!==epoch)return;nativeRecovery=false;disconnectResult='complete';reconnectState=null;rememberReconnect();clear();};
   // A queued native deletion can finish after the UI timeout. Keep this one
   // completion listener so its confirmed result still reconciles the screen.
   const acknowledgement=g.GoogleDriveNative?nativeCall('disconnect',[],value=>{if(attempt===epoch&&value.ok===true&&!value.error)confirmed();}):Promise.resolve({ok:true});
   disconnectTask=(async()=>{try{const result=await acknowledgement;if(result.ok!==true)throw problem('Dispozitivul nu a confirmat deconectarea. Reîncearcă.','disconnect_failed');confirmed();if(token&&g.google?.accounts?.oauth2){try{g.google.accounts.oauth2.revoke(token,()=>{});}catch(_){}}}catch(e){if(attempt===epoch)disconnectResult='failed';throw e;}finally{disconnecting=false;disconnectTask=null;changed();}})();
  changed();
  return disconnectTask;
 }
 g.SalonDrive={load,connect,status,backup,restore,disconnect,connected,online,canDisconnect:()=>!disconnecting&&(connected()||nativeRecovery||connecting),isConnecting:()=>connecting||disconnecting,isDisconnecting:()=>disconnecting,disconnectState:()=>disconnectResult,reconnectNotice,dismissReconnect,request,identity:()=>identity};
 if(navigator.onLine&&g.SalonGoogleConfig?.clientId)load().catch(()=>{});
})(window);
