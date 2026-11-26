/*
 * SalonSyncCore protocol 1. No storage or network side effects.
 *
 * flatten(state) -> record map; inflate(map, preferredServiceIds?) -> schema-1
 * state, keeping the preferred existing service order before new services.
 * diff(before, after) -> [{key, before: record|null, after: record|null}].
 * Operation: {id, createdAt: canonical ISO timestamp, changes: diff(...)}.
 * Device metadata is separate from business state and may contain credentials.
 * queueChange(meta, before, after, id, stamp) queues while joined, even paused.
 * prepare(meta, limit=50) selects unblocked operations; the caller decides when
 * network use is enabled. Atomic operations are never split.
 * applyResponse(meta, current, sent, response, stamp=nowISO) -> {meta, state}.
 * response: {protocol:1, workspaceId, initialized:true, serverRevision,
 *   results:[{id,status:'applied'|'conflict'|'rejected',reason?,keys?}], state}.
 * resolve(meta, current, conflictIndex, 'server'|'local', newId, stamp)
 * resolves the entire connected component of overlapping operation keys.
 * Discarded proposals are retained in meta.resolutionArchive as
 * {at,choice,operations}. Local audited appointment resolutions keep the
 * authoritative server audit prefix plus at most one fresh correction.
 * meta.retainedDependencies maps operation IDs to missing server client or
 * supplier keys needed by protected appointment/audit or expense records.
 * It never alters sent CAS
 * operations. operationKeys(meta, operation) includes these UI/merge keys.
 * Resolution archives retain supporting catalog copies in retainedRecords.
 * Frozen bootstrap snapshots are validated but never canonicalized: retries
 * must preserve optional-field absence and array order across app upgrades.
 * All outputs are independent copies; malformed data throws before mutation.
 */
(function (global) {
 'use strict';
 const MAX_OPERATIONS=10000,MAX_CHANGES=500000;
 const COLLECTIONS=['clients','services','appointments','expenses','suppliers'];
 const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const fail=message=>{throw new Error(message||'Date de sincronizare invalide.');};
 const string=(value,max=200,empty=false)=>typeof value==='string'&&value.length<=max&&(empty||value.length>0);
 const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;

 function clone(value){
  const seen=new Set();
  function copy(input,depth){
   if(depth>100)fail('Datele de sincronizare sunt prea adânc imbricate.');
   if(input===null||typeof input==='string'||typeof input==='boolean')return input;
   if(typeof input==='number'){if(!Number.isFinite(input))fail();return input;}
   if(!object(input)&&!Array.isArray(input))fail();
   if(seen.has(input))fail('Datele de sincronizare conțin referințe circulare.');
   const prototype=Object.getPrototypeOf(input);if(!Array.isArray(input)&&prototype!==null&&Object.prototype.toString.call(input)!=='[object Object]')fail();
   seen.add(input);
   const result=Array.isArray(input)?input.map(item=>copy(item,depth+1)):{};
   if(!Array.isArray(input))Object.keys(input).forEach(key=>Object.defineProperty(result,key,{value:copy(input[key],depth+1),enumerable:true,writable:true,configurable:true}));
   seen.delete(input);return result;
  }
  return copy(value,0);
 }

 function equal(left,right){
  if(left===right)return true;
  if(left===null||right===null||typeof left!==typeof right)return false;
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((item,index)=>equal(item,right[index]));
  if(!object(left)||!object(right))return false;
  const keys=Object.keys(left),others=Object.keys(right);return keys.length===others.length&&keys.every(key=>own(right,key)&&equal(left[key],right[key]));
 }
 function appointmentSnapshot(record){
  const result={clientId:record.clientId,date:record.date,start:record.start,duration:record.duration,price:record.price,status:record.status,notes:record.notes||'',services:record.services.map(service=>({serviceId:service.serviceId,name:service.name,price:service.price,...(own(service,'color')?{color:service.color}:{}),...(own(service,'duration')?{duration:service.duration}:{})}))};
  if(own(record,'color'))result.color=record.color;return result;
 }
 function appointmentChanged(before,after){const comparable=record=>{const snapshot=appointmentSnapshot(record);if(snapshot.color)snapshot.color=snapshot.color.toLowerCase();snapshot.services.forEach(service=>{if(service.color)service.color=service.color.toLowerCase();});return snapshot;};return !equal(comparable(before),comparable(after));}
 function rebaseAppointment(base,local,stamp){
  if(!base||!local||!(base.status==='completed'||local.status==='completed'||base.corrections?.length||local.corrections?.length))return local;
  const result=clone(local);if(own(base,'corrections'))result.corrections=clone(base.corrections);else delete result.corrections;
  if(appointmentChanged(base,local)){const history=result.corrections||[];if(history.length>=1000)fail('Istoricul programării de pe server a atins limita de corecții.');result.corrections=[...history,{at:stamp,before:appointmentSnapshot(base),after:appointmentSnapshot(local),reason:'Rezolvare conflict de sincronizare'}];}
  return result;
 }

 function validKey(key){return key==='settings'||key==='meta'||typeof key==='string'&&COLLECTIONS.some(collection=>key.startsWith(collection+'/')&&string(key.slice(collection.length+1),100));}
 const dependencyKey=key=>validKey(key)&&(key.startsWith('clients/')||key.startsWith('suppliers/'));
 function validRecord(key,record){
  if(record===null)return key!=='settings'&&key!=='meta';
  if(!object(record))return false;
  if(key==='settings')return true;
  if(key==='meta')return typeof record.demo==='boolean'&&Object.keys(record).length===1;
  const slash=key.indexOf('/');return string(record.id,100)&&record.id===key.slice(slash+1);
 }
 function checkedMap(raw){
  if(!object(raw))fail();const map={};
  Object.keys(raw).forEach(key=>{if(!validKey(key)||!validRecord(key,raw[key])||raw[key]===null)fail();Object.defineProperty(map,key,{value:clone(raw[key]),enumerable:true,writable:true,configurable:true});});
  if(!own(map,'settings')||!own(map,'meta'))fail('Lipsește configurația agendei sincronizate.');return map;
 }
 function flatten(state){
  if(!object(state)||state.version!==1||!object(state.settings)||typeof state.demo!=='boolean')fail('Agenda pentru sincronizare nu este validă.');
  const map={settings:clone(state.settings),meta:{demo:state.demo}};
  COLLECTIONS.forEach(collection=>{
   const records=state[collection]===undefined&&['expenses','suppliers'].includes(collection)?[]:state[collection];
   if(!Array.isArray(records)||records.length>200000)fail();
   records.forEach(record=>{if(!object(record)||!string(record.id,100))fail();const key=collection+'/'+record.id;if(own(map,key))fail('Identificator duplicat în agenda sincronizată.');map[key]=clone(record);});
  });return map;
 }
 function inflate(raw,preferredServiceIds){
  const map=checkedMap(raw),state={version:1,demo:map.meta.demo,settings:clone(map.settings),clients:[],services:[],appointments:[],expenses:[],suppliers:[]};
  Object.keys(map).sort().forEach(key=>{if(key!=='settings'&&key!=='meta')state[key.slice(0,key.indexOf('/'))].push(clone(map[key]));});
  if(preferredServiceIds!==undefined){
   if(!Array.isArray(preferredServiceIds)||preferredServiceIds.length>200000||preferredServiceIds.some(id=>!string(id,100))||new Set(preferredServiceIds).size!==preferredServiceIds.length)fail('Ordinea serviciilor nu este validă.');
   const rank=new Map(preferredServiceIds.map((id,index)=>[id,index]));state.services.sort((a,b)=>(rank.get(a.id)??rank.size)-(rank.get(b.id)??rank.size));
  }
  return state;
 }
 function changesBetween(before,after,keys){
  return Array.from(keys||new Set([...Object.keys(before),...Object.keys(after)])).sort().filter(key=>!equal(own(before,key)?before[key]:null,own(after,key)?after[key]:null)).map(key=>({key,before:own(before,key)?clone(before[key]):null,after:own(after,key)?clone(after[key]):null}));
 }
 function diff(before,after){return changesBetween(flatten(before),flatten(after));}

 function validServerUrl(value){
  if(!string(value,2048)||!/^https?:\/\//i.test(value)||value.trim()!==value||/[?#\\\s]|[^\x21-\x7e]/.test(value))return false;
  try{
   const url=new URL(value),authority=value.slice(value.indexOf('://')+3).split('/')[0];if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||!url.hostname||url.port==='0'||authority.includes('@'))return false;
   if(url.protocol==='https:')return true;
   const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
   if(host==='localhost'||host==='::1'||/^(fc|fd)[a-f\d]{2}:/.test(host)||/^fe[89ab][a-f\d]:/.test(host))return true;
   if(['.local','.ts.net'].some(suffix=>host.endsWith(suffix)))return true;
   const privateV4=parts=>parts[0]===10||parts[0]===127||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===192&&parts[1]===168||parts[0]===169&&parts[1]===254||parts[0]===100&&parts[1]>=64&&parts[1]<=127;
   const mapped=host.match(/^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/);if(mapped){const hi=parseInt(mapped[1],16),lo=parseInt(mapped[2],16);return privateV4([hi>>8,hi&255,lo>>8,lo&255]);}
   const rawHost=authority.split(':')[0].toLowerCase().replace(/\.$/,'');
   if(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rawHost)){const parts=rawHost.split('.');if(parts.some(part=>part.length>1&&part[0]==='0'||Number(part)>255))return false;return privateV4(parts.map(Number));}
   return false;
  }catch(error){return false;}
 }

 function operation(raw,conflict=false){
  if(!object(raw)||!string(raw.id,200)||!iso(raw.createdAt)||!Array.isArray(raw.changes)||!raw.changes.length||raw.changes.length>MAX_CHANGES)fail('Operație de sincronizare invalidă.');
  const seen=new Set(),changes=raw.changes.map(change=>{
   if(!object(change)||!validKey(change.key)||!own(change,'before')||!own(change,'after')||!validRecord(change.key,change.before)||!validRecord(change.key,change.after)||equal(change.before,change.after)||seen.has(change.key))fail('Modificări CAS invalide.');
   seen.add(change.key);return {key:change.key,before:clone(change.before),after:clone(change.after)};
  });
  const result={id:raw.id,createdAt:raw.createdAt,changes};
  if(conflict){if(!['conflict','rejected'].includes(raw.status)||!string(raw.reason,5000,true))fail();result.status=raw.status;result.reason=raw.reason;result.keys=changes.map(change=>change.key);}
  return result;
 }
 function createDevice(id){
  if(!string(id,100))fail('Identificator de dispozitiv invalid.');
  return {version:1,deviceId:id,name:'Tabletă / telefon',role:'',enabled:false,serverUrl:'http://192.168.0.20:8787',remoteUrl:'',token:'',workspaceId:'',joined:false,queue:[],conflicts:[],lastSync:'',base:null,serverRevision:0};
 }
 function validateDevice(raw){
  if(!object(raw)||raw.version!==1||!string(raw.deviceId,100)||!['','master','secondary'].includes(raw.role)||typeof raw.enabled!=='boolean'||typeof raw.joined!=='boolean'||!validServerUrl(raw.serverUrl)||!(raw.remoteUrl===''||validServerUrl(raw.remoteUrl))||!string(raw.token,2048,true)||!string(raw.workspaceId,200,true)||!(raw.lastSync===''||iso(raw.lastSync))||!Array.isArray(raw.queue)||!Array.isArray(raw.conflicts)||raw.queue.length+raw.conflicts.length>MAX_OPERATIONS)fail('Configurația dispozitivului nu este validă.');
  const result=clone(raw);result.name=raw.name===undefined?'Tabletă / telefon':raw.name;if(!string(result.name,150))fail();
  result.serverRevision=raw.serverRevision===undefined?0:raw.serverRevision;if(!Number.isSafeInteger(result.serverRevision)||result.serverRevision<0)fail();
  result.queue=raw.queue.map(item=>operation(item));result.conflicts=raw.conflicts.map(item=>operation(item,true));
  const ids=[...result.queue,...result.conflicts].map(item=>item.id);if(new Set(ids).size!==ids.length)fail('Operații duplicate în configurația dispozitivului.');
  if(own(raw,'retainedDependencies')){if(!object(raw.retainedDependencies))fail();result.retainedDependencies={};Object.keys(raw.retainedDependencies).forEach(id=>{const keys=raw.retainedDependencies[id];if(!ids.includes(id)||!Array.isArray(keys)||!keys.length||keys.some(key=>!dependencyKey(key))||new Set(keys).size!==keys.length)fail('Dependențe locale de sincronizare invalide.');Object.defineProperty(result.retainedDependencies,id,{value:clone(keys),enumerable:true,writable:true,configurable:true});});}
  if(raw.base===null)result.base=null;else result.base=inflate(flatten(raw.base));
  if(own(raw,'bootstrap')){if(raw.bootstrap===null)result.bootstrap=null;else {if(!object(raw.bootstrap)||!string(raw.bootstrap.id,200))fail();flatten(raw.bootstrap.state);result.bootstrap={id:raw.bootstrap.id,state:clone(raw.bootstrap.state)};}}
  if(own(raw,'resolutionArchive')){if(!Array.isArray(raw.resolutionArchive))fail();result.resolutionArchive=raw.resolutionArchive.map(entry=>{if(!object(entry)||!iso(entry.at)||!['server','local','disconnect'].includes(entry.choice)||!Array.isArray(entry.operations)||!entry.operations.length||entry.operations.length>MAX_OPERATIONS)fail('Arhiva rezolvărilor nu este validă.');const saved={at:entry.at,choice:entry.choice,operations:entry.operations.map(op=>operation(op,own(op,'status')))};if(own(entry,'retainedRecords')){if(!object(entry.retainedRecords))fail();saved.retainedRecords={};Object.keys(entry.retainedRecords).forEach(key=>{if(!dependencyKey(key)||!validRecord(key,entry.retainedRecords[key])||entry.retainedRecords[key]===null)fail();saved.retainedRecords[key]=clone(entry.retainedRecords[key]);});}return saved;});}
  return result;
 }
 function queueChange(raw,previous,next,opId,createdAt){
  const meta=validateDevice(raw),changes=diff(previous,next);if(!meta.joined||!changes.length)return meta;
  const queued=operation({id:opId,createdAt,changes}),duplicate=[...meta.queue,...meta.conflicts].find(item=>item.id===opId);
  if(duplicate){if(!equal(duplicate.changes,queued.changes)||duplicate.createdAt!==queued.createdAt)fail('Identificatorul operației a fost reutilizat pentru alte modificări.');return meta;}
  if(meta.queue.length+meta.conflicts.length>=MAX_OPERATIONS)fail('Coada de sincronizare este plină. Sincronizează înainte de alte modificări.');meta.queue.push(queued);if(meta.base)refreshDependencies(meta,flatten(next),flatten(meta.base));return meta;
 }
 const keysOf=op=>op.changes.map(change=>change.key);
 function operationKeys(meta,op){return Array.from(new Set([...keysOf(op),...(meta.retainedDependencies?.[op.id]||[])]));}
 const intersects=(op,keys,keySelector=keysOf)=>keySelector(op).some(key=>keys.has(key));
 function closure(initial,operations,keySelector=keysOf){const keys=new Set(initial);let changed=true;while(changed){changed=false;operations.forEach(op=>{if(intersects(op,keys,keySelector))keySelector(op).forEach(key=>{if(!keys.has(key)){keys.add(key);changed=true;}});});}return keys;}
 function refreshDependencies(meta,local,base){
  const dependencies={};[...meta.queue,...meta.conflicts].forEach(op=>{const needed=new Set();op.changes.forEach(change=>{
   if(!own(local,change.key))return;const record=local[change.key];let collection,ids;
   if(change.key.startsWith('appointments/')){collection='clients';ids=[record.clientId,...(record.corrections||[]).flatMap(entry=>[entry.before?.clientId,entry.after?.clientId])];}
   else if(change.key.startsWith('expenses/')){collection='suppliers';ids=[record.supplierId];}
   else return;
   ids.forEach(id=>{const key=collection+'/'+id;if(string(id,100)&&!own(base,key)&&own(local,key))needed.add(key);});
  });if(needed.size)Object.defineProperty(dependencies,op.id,{value:Array.from(needed).sort(),enumerable:true,writable:true,configurable:true});});
  if(Object.keys(dependencies).length)meta.retainedDependencies=dependencies;else delete meta.retainedDependencies;
 }
 function prepare(raw,max=50){
  const meta=validateDevice(raw);if(!Number.isInteger(max)||max<1||max>50)fail('Limita lotului de sincronizare nu este validă.');
  const selector=op=>operationKeys(meta,op),blocked=closure(meta.conflicts.flatMap(selector),[...meta.conflicts,...meta.queue],selector);return meta.queue.filter(op=>!intersects(op,blocked,selector)).slice(0,max).map(clone);
 }
 function responseData(raw,sent,meta){
  if(!object(raw)||raw.protocol!==1||raw.initialized!==true||!string(raw.workspaceId,200)||meta.workspaceId&&raw.workspaceId!==meta.workspaceId||!Number.isSafeInteger(raw.serverRevision)||raw.serverRevision<meta.serverRevision||!Array.isArray(raw.results)||raw.results.length!==sent.length)fail('Răspuns de sincronizare invalid sau pentru altă agendă.');
  const sentMap=new Map(sent.map(op=>[op.id,op]));if(sentMap.size!==sent.length)fail();const seen=new Set();
  const results=raw.results.map(result=>{
   if(!object(result)||!sentMap.has(result.id)||seen.has(result.id)||!['applied','conflict','rejected'].includes(result.status)||own(result,'reason')&&!string(result.reason,5000,true)||own(result,'keys')&&(!Array.isArray(result.keys)||result.keys.some(key=>!keysOf(sentMap.get(result.id)).includes(key))))fail('Confirmare de sincronizare invalidă.');
   seen.add(result.id);return {id:result.id,status:result.status,reason:result.reason||'',keys:result.keys||keysOf(sentMap.get(result.id))};
  });return {results,state:inflate(flatten(raw.state)),workspaceId:raw.workspaceId,serverRevision:raw.serverRevision};
 }
 function overlay(map,local,keys){keys.forEach(key=>{if(own(local,key))map[key]=clone(local[key]);else delete map[key];});return map;}
 function protectClientDeletions(merged,server,operations){
  const deleting=new Set(operations.flatMap(op=>op.changes.filter(change=>change.key.startsWith('clients/')&&change.after===null).map(change=>change.key))),needed=new Set();
  if(!deleting.size)return merged;
  Object.keys(merged).forEach(key=>{if(!key.startsWith('appointments/'))return;const appointment=merged[key],ids=[appointment.clientId,...(appointment.corrections||[]).flatMap(entry=>[entry.before?.clientId,entry.after?.clientId])];ids.forEach(id=>{const clientKey='clients/'+id;if(string(id,100)&&deleting.has(clientKey)&&!own(merged,clientKey)&&own(server,clientKey))needed.add(clientKey);});});
  // A remote booking can make a formerly unused local contact indispensable.
  // Keep the sent physical-delete CAS immutable; explicit local resolution will
  // instead enqueue a fresh tombstone update without removing any history.
  needed.forEach(key=>{merged[key]={...clone(server[key]),deleted:true,archived:true,phone:'',notes:''};});return merged;
 }
 function applyResponse(raw,currentState,sentOps,response,stamp=new Date().toISOString()){
  const meta=validateDevice(raw),local=flatten(currentState),sent=sentOps.map(item=>operation(item));if(!iso(stamp))fail();
  const data=responseData(response,sent,meta),queuedById=new Map(meta.queue.map(op=>[op.id,op])),sentById=new Map(sent.map(op=>[op.id,op]));
  data.results.forEach(result=>{const queued=queuedById.get(result.id);if(!queued)return;if(!equal(queued,sentById.get(result.id)))fail('Confirmarea nu corespunde operației trimise.');
   meta.queue=meta.queue.filter(op=>op.id!==result.id);
   if(result.status!=='applied')meta.conflicts.push({...clone(queued),status:result.status,reason:result.reason,keys:keysOf(queued)});
  });
  const server=flatten(data.state);refreshDependencies(meta,local,server);const pending=[...meta.queue,...meta.conflicts],keep=new Set(pending.flatMap(op=>operationKeys(meta,op))),merged=protectClientDeletions(overlay({...server},local,keep),server,pending);
  meta.base=clone(data.state);meta.workspaceId=data.workspaceId;meta.serverRevision=data.serverRevision;meta.lastSync=stamp;meta.joined=true;if(own(meta,'bootstrap'))delete meta.bootstrap;
  return {meta,state:inflate(merged,currentState.services.map(service=>service.id))};
 }
 function resolve(raw,currentState,index,choice,newOpId,stamp){
  const meta=validateDevice(raw);if(!Number.isInteger(index)||index<0||index>=meta.conflicts.length||!['server','local'].includes(choice)||meta.base===null||!iso(stamp))fail('Conflictul nu poate fi rezolvat.');
  const local=flatten(currentState),base=flatten(meta.base);refreshDependencies(meta,local,base);const selector=op=>operationKeys(meta,op),keys=closure(selector(meta.conflicts[index]),[...meta.conflicts,...meta.queue],selector);
  const removed=[...meta.conflicts,...meta.queue].filter(op=>intersects(op,keys,selector));if(removed.length){const retained={};removed.flatMap(op=>meta.retainedDependencies?.[op.id]||[]).forEach(key=>{if(own(local,key))retained[key]=clone(local[key]);});meta.resolutionArchive=[...(meta.resolutionArchive||[]),{at:stamp,choice,operations:removed.map(clone),...(Object.keys(retained).length?{retainedRecords:retained}:{})}];}
  meta.queue=meta.queue.filter(op=>!intersects(op,keys,selector));meta.conflicts=meta.conflicts.filter(op=>!intersects(op,keys,selector));
  if(choice==='server'){const merged=overlay(local,base,keys);refreshDependencies(meta,merged,base);return {meta,state:inflate(merged,currentState.services.map(service=>service.id))};}
  keys.forEach(key=>{if(key.startsWith('appointments/')&&own(base,key)&&own(local,key))local[key]=rebaseAppointment(base[key],local[key],stamp);});
  const changes=changesBetween(base,local,keys);if(changes.length){const queued=operation({id:newOpId,createdAt:stamp,changes});if([...meta.queue,...meta.conflicts].some(op=>op.id===newOpId)||meta.queue.length+meta.conflicts.length>=MAX_OPERATIONS)fail('Corecția conflictului nu poate fi adăugată în coadă.');meta.queue.push(queued);}
  refreshDependencies(meta,local,base);return {meta,state:inflate(local,currentState.services.map(service=>service.id))};
 }
 const api={flatten,inflate,equal,diff,createDevice,validateDevice,validServerUrl,queueChange,prepare,applyResponse,resolve,operationKeys};
 global.SalonSyncCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
