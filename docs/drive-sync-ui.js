(function(g){
 'use strict';
 const J=g.SalonDriveJournal,C=g.SalonSyncCore,EMAIL='macsocietysrl@gmail.com';
 const clone=x=>JSON.parse(JSON.stringify(x)),identifier=()=>Date.now().toString(36)+'-'+crypto.randomUUID();
 async function list(){
  const files=[];let page='';
  do{const query=new URLSearchParams({q:"trashed=false and properties has { key='frizerieJournal' and value='v1' }",fields:'files(id,size),nextPageToken',pageSize:'100',...(page?{pageToken:page}:{})});const data=await(await g.SalonDrive.request('https://www.googleapis.com/drive/v3/files?'+query)).json();files.push(...data.files);page=data.nextPageToken||'';if(files.length>100)throw Error('Prea multe jurnale Drive.');}while(page);
  const result=[];
  for(const file of files){if(!/^[A-Za-z0-9_-]{1,200}$/.test(file.id)||Number(file.size)>30*1024*1024)throw Error('Fișier de sincronizare invalid sau prea mare.');const data=await(await g.SalonDrive.request('https://www.googleapis.com/drive/v3/files/'+file.id+'?alt=media')).json();result.push({fileId:file.id,doc:data});}return result;
 }
 async function upload(doc,fileId){
  const body=JSON.stringify(doc);if(new TextEncoder().encode(body).length>30*1024*1024)throw Error('Jurnalul este prea mare. Este necesară arhivarea lui.');
  const url='https://www.googleapis.com/upload/drive/v3/files'+(fileId?'/'+fileId:'')+'?uploadType=resumable&fields=id';
  const init=await g.SalonDrive.request(url,{method:fileId?'PATCH':'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/json'},body:JSON.stringify({name:'Agenda-Frizerie-sync-'+doc.device+'.json',mimeType:'application/json',properties:{frizerieJournal:'v1'}})});
  let target;try{target=new URL(init.headers.get('Location'));}catch(_){throw Error('Google nu a confirmat transferul.');}if(target.origin!=='https://www.googleapis.com'||!target.pathname.startsWith('/upload/drive/v3/files'))throw Error('Adresă Drive invalidă.');
  const result=await(await g.SalonDrive.request(target.href,{method:'PUT',headers:{'Content-Type':'application/json'},body})).json();if(!/^[A-Za-z0-9_-]{1,200}$/.test(result.id))throw Error('Lipsește confirmarea Drive.');return result.id;
 }
 function create(hooks){
  let saved=clone(hooks.getState()),meta,busy=false,error='',timer,conflicts=[];
  const native=!!g.Android;
  try{const raw=native?g.Android.loadDevice():g.SalonStorage.readBundle()?.device;meta=typeof raw==='string'&&raw?JSON.parse(raw):raw;if(meta?._storageError)throw Error('read');if(meta&&meta.kind!=='frizerie-drive-local'){if(meta.protocol===1)meta={kind:'frizerie-drive-local',device:identifier(),paused:false,legacyConfiguration:meta};else throw Error('old');}if(meta?.doc){if(meta.doc.device!==meta.device)throw Error('device');conflicts=J.replay([meta.doc,...(meta.others||[])],hooks.validate).conflicts;}}
  catch(_){error='Configurația de sincronizare nu poate fi citită. Datele locale sunt păstrate.';meta={kind:'frizerie-drive-local',device:identifier(),paused:true,corrupt:true};}
  meta=meta||{kind:'frizerie-drive-local',device:identifier(),paused:false};
  function write(next,proposal){
   const accepted=ok=>{if(ok){meta=clone(proposal);saved=clone(next);g.dispatchEvent(new Event('salon-storage-committed'));}return ok;};
   try{if(native)return accepted(g.Android.saveLocal(JSON.stringify(next),JSON.stringify(proposal)));return g.SalonStorage.writeBundle(next,proposal).then(accepted);}catch(_){return native?false:Promise.resolve(false);}
  }
  const allDocs=m=>[m.doc,...(m.others||[])].filter(Boolean);
  function save(next,resolves){
   if(meta.corrupt)return native?false:Promise.resolve(false);
   const proposal=clone(meta);
   if(proposal.doc){const replay=J.replay(allDocs(proposal),hooks.validate);let op=J.operation(saved,next,proposal.device,replay.heads,identifier());if(resolves){op=op||{id:identifier(),device:proposal.device,parents:replay.heads,changes:[]};op.resolves=[resolves];}if(op)proposal.doc.operations.push(op);}
   const result=write(next,proposal);if(native){if(result)schedule(1500);return result;}return result.then(ok=>{if(ok)schedule(1500);return ok;});
  }
  const online=()=>g.SalonDrive.online?g.SalonDrive.online():navigator.onLine!==false;
  function updateButton(b){const action=b.dataset.driveAction;b.disabled=b.dataset.driveWorking==='true'||(action==='connect'&&(busy||!online()||g.SalonDrive.connected()||g.SalonDrive.isConnecting?.()))||(action==='sync'&&(busy||!online()||!g.SalonDrive.connected()||g.SalonDrive.isConnecting?.()));}
  function refreshButtons(){for(const b of document.querySelectorAll('[data-drive-action]'))updateButton(b);}
  function status(){if(!online())return 'Offline · modificările sunt păstrate local';if(error)return error;if(busy)return 'Sincronizare Google Drive în curs…';if(conflicts.length)return conflicts.length+' conflicte de verificat';if(meta.paused)return 'Sincronizare oprită';if(!meta.doc)return 'Google Drive neconectat';if(!g.SalonDrive.connected())return 'Date locale · reconectează Google Drive';return meta.lastSync?'Ultima sincronizare: '+new Date(meta.lastSync).toLocaleString('ro-RO'):'Modificări păstrate local';}
  function refresh(){hooks.refresh?.();for(const node of document.querySelectorAll('[data-drive-status]'))node.textContent=status();refreshButtons();}
  function schedule(delay=15000){clearTimeout(timer);if(!meta.paused&&!meta.corrupt)timer=setTimeout(run,delay);}
  async function run(allowJoin=false){
   if(!online()||busy||(!meta.doc&&!allowJoin)||meta.paused||meta.corrupt||document.hidden||!g.SalonDrive.connected()){schedule();return;}
   if(hooks.hasOpenForm()){schedule();return;}
   if(g.SalonDrive.identity()?.email?.toLowerCase()!==EMAIL){error='Folosește contul '+EMAIL+'.';refresh();schedule();return;}
   busy=true;error='';refresh();
   try{
    const remote=await list();if(hooks.hasOpenForm())return;
    let proposal=clone(meta),next;
    if(!proposal.doc){
     if(remote.length){const replay=J.replay(remote.map(r=>r.doc),hooks.validate);if(!g.confirm('Există deja o agendă în Drive. Preiei această agendă pentru sincronizare? Datele locale actuale vor fi păstrate într-o copie de recuperare.'))return;proposal.preJoinBackup=clone(saved);proposal.doc={protocol:'frizerie-drive-1',workspace:remote[0].doc.workspace,device:proposal.device,genesis:remote[0].doc.genesis,operations:[]};proposal.others=remote.map(r=>r.doc);next=replay.state;}
     else{if(!g.confirm('Creezi agenda comună în Google Drive folosind datele acestui dispozitiv? Pe iPhone vei conecta același cont și vei prelua această agendă.'))return;proposal.doc={protocol:'frizerie-drive-1',workspace:identifier(),device:proposal.device,genesis:clone(saved),operations:[]};proposal.others=[];next=clone(saved);}
    }else{
     const same=remote.filter(r=>r.doc.device===proposal.device);if(same.length>1)throw Error('Există mai multe jurnale pentru acest dispozitiv. Nu au fost înlocuite.');
     if(same.length){const known=new Map(proposal.doc.operations.map(op=>[op.id,op]));for(const op of same[0].doc.operations){if(known.has(op.id)&&!C.equal(known.get(op.id),op))throw Error('Jurnal local diferit de copia Drive.');known.set(op.id,op);}proposal.doc.operations=[...known.values()];proposal.fileId=same[0].fileId;}
     // Missing remote logs are never discarded; replay then fails safely if the
     // user's Drive copy has lost a referenced operation.
     const others=new Map((proposal.others||[]).map(d=>[d.device,d]));for(const item of remote)if(item.doc.device!==proposal.device)others.set(item.doc.device,item.doc);proposal.others=[...others.values()];
     const replay=J.replay(allDocs(proposal),hooks.validate);next=replay.state;conflicts=replay.conflicts;
    }
    if(hooks.hasOpenForm())return;
    const preferred=(meta.doc?saved.services:proposal.doc.genesis.services).map(s=>s.id),rank=new Map(preferred.map((id,index)=>[id,index]));next.services.sort((a,b)=>(rank.get(a.id)??1e9)-(rank.get(b.id)??1e9));
    // Persist the adopted workspace and original data before any network write.
    if(!await write(next,proposal))throw Error('Salvarea locală a sincronizării nu a reușit.');hooks.setState(clone(next));refresh();
    const fileId=await upload(proposal.doc,proposal.fileId);
    // A user may save while the upload is running. Never commit the old snapshot.
    const acknowledged=clone(meta);acknowledged.fileId=fileId;acknowledged.lastSync=new Date().toISOString();if(!await write(saved,acknowledged))throw Error('Confirmarea Drive nu a putut fi salvată local.');
   }catch(e){error=e.message;}
   finally{busy=false;refresh();schedule();}
  }
  async function connect(){if(!online())throw Error('Telefonul nu are internet.');if(meta.corrupt)throw Error('Configurație locală de recuperat. Exportă mai întâi datele.');if(hooks.hasOpenForm())throw Error('Închide formularul și salvează modificările.');if(!g.SalonDrive.connected())await g.SalonDrive.connect();meta.paused=false;await run(true);}
  function controls(){
   const root=document.createElement('section');root.className='card sync-settings drive-sync';const title=document.createElement('h2');title.textContent='Sincronizare Android ↔ iPhone';const state=document.createElement('p');state.dataset.driveStatus='';state.className='setting-desc';state.textContent=status();const note=document.createElement('p');note.className='setting-desc';note.textContent='Cont comun: '+EMAIL+'. Modificările se transmit când aplicația este deschisă și conectată. Backupul separat se găsește mai jos. Nu șterge fișierele de sincronizare din Drive.';root.append(title,state,note);
   const add=(label,action,kind='local')=>{const b=document.createElement('button');b.type='button';b.className='btn secondary';b.textContent=label;b.dataset.driveAction=kind;updateButton(b);b.onclick=async()=>{if(b.disabled)return;b.dataset.driveWorking='true';b.disabled=true;try{await action();}catch(e){error=e.message;refresh();}finally{delete b.dataset.driveWorking;updateButton(b);}};root.append(b);};
   add('Conectează și sincronizează',connect,'connect');add('Sincronizează acum',()=>run(true),'sync');add(meta.paused?'Reia sincronizarea':'Oprește sincronizarea',async()=>{const next=clone(meta);next.paused=!next.paused;if(!await write(saved,next))throw Error('Preferința nu a putut fi salvată.');refresh();if(!meta.paused)run();});
   if(meta.preJoinBackup)add('Exportă copia dinaintea sincronizării',()=>hooks.exportRaw(JSON.stringify(meta.preJoinBackup,null,2)));
   for(const conflict of conflicts){const item=document.createElement('div');item.className='notice';item.textContent=conflict.reason+' '+conflict.changes.map(c=>c.after?.name||c.key).join(', ');root.append(item);add('Păstrează datele curente',async()=>{if(!await save(saved,conflict.id))throw Error('Rezolvarea nu a putut fi salvată.');await run();});add('Aplică propunerea alternativă',async()=>{
    if(hooks.hasOpenForm())throw Error('Închide formularul înainte de rezolvarea conflictului.');
    const map=C.flatten(saved);for(const c of conflict.changes){if(c.after===null)delete map[c.key];else{let value=clone(c.after);const before=map[c.key];if(c.key.startsWith('appointments/')&&before&&(before.status==='completed'||before.corrections?.length)){value.corrections=clone(before.corrections||[]);value=g.SalonCore.recordAppointmentCorrection(before,value,new Date().toISOString(),'Rezolvare conflict Google Drive');}map[c.key]=value;}}const next=hooks.validate(C.inflate(map));
    if(!g.confirm('Înlocuiești valorile curente pentru toate înregistrările din această propunere? Ambele versiuni rămân în jurnalul Drive.'))return;
    if(!await save(next,conflict.id))throw Error('Rezolvarea nu a putut fi salvată.');hooks.setState(next);await run();
   });}
   return root;
  }
  schedule();g.addEventListener('online',()=>{refresh();schedule(1000);});g.addEventListener('offline',refresh);g.addEventListener('salon-drive-changed',refresh);g.addEventListener('salon-network-changed',()=>{refresh();if(online())schedule(1000);});document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(1000);});
  return {save,status,isJoined:()=>!!meta.doc,renderSettings:controls,onboarding:()=>{},isBusy:()=>busy};
 }
 g.SalonDriveSyncUI={create};g.SalonSyncUI={create};
})(window);
