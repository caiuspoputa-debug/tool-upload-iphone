/* Immutable per-device operations. No device overwrites another device's log.
   Replay is deterministic and applies every multi-record change atomically.
   Concurrent changes to the same records remain explicit conflicts. */
(function(g){
 'use strict';
 const C=g.SalonSyncCore||(typeof require==='function'?require('./sync.js'):null);
 const clone=x=>JSON.parse(JSON.stringify(x));
 const id=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(s);
 function check(doc,validate){
  if(!doc||doc.protocol!=='frizerie-drive-1'||!id(doc.workspace)||!id(doc.device)||!Array.isArray(doc.operations)||doc.operations.length>10000)throw Error('Jurnal Drive invalid.');
  validate(doc.genesis);const ids=new Set();
  for(const op of doc.operations){
   if(!id(op.id)||ids.has(op.id)||op.device!==doc.device||!Array.isArray(op.parents)||op.parents.length>100||!op.parents.every(id)||new Set(op.parents).size!==op.parents.length||op.parents.includes(op.id)||!Array.isArray(op.changes)||(!op.changes.length&&!op.resolves?.length)||op.changes.length>200000||op.resolves&&(!Array.isArray(op.resolves)||op.resolves.length>100||!op.resolves.every(id)))throw Error('Operație Drive invalidă.');
   ids.add(op.id);const keys=new Set();
   for(const change of op.changes){if(!change||typeof change.key!=='string'||!/^((settings|meta)|(clients|services|appointments|expenses|suppliers)\/[A-Za-z0-9_-]{1,100})$/.test(change.key)||keys.has(change.key)||!Object.hasOwn(change,'before')||!Object.hasOwn(change,'after'))throw Error('Modificare Drive invalidă.');keys.add(change.key);}
  }
  return clone(doc);
 }
 function replay(documents,validate){
  if(!documents.length||documents.length>100)throw Error('Nu există un jurnal comun sau sunt prea multe dispozitive.');
  const docs=documents.map(d=>check(d,validate)),first=docs[0],all=new Map();
  for(const doc of docs){if(doc.workspace!==first.workspace||!C.equal(doc.genesis,first.genesis))throw Error('Există agende Drive diferite. Alege aceeași agendă înainte de sincronizare.');for(const op of doc.operations){if(all.has(op.id)&&!C.equal(all.get(op.id),op))throw Error('Identificator Drive duplicat.');all.set(op.id,op);}}
  if(all.size>20000)throw Error('Jurnalul necesită arhivare înainte de continuare.');
  for(const op of all.values())for(const parent of op.parents)if(!all.has(parent))throw Error('Lipsește un jurnal de dispozitiv din Drive. Datele locale sunt păstrate.');
  let map=C.flatten(validate(clone(first.genesis)));const pending=new Map(all),done=new Set(),conflicts=[],applied=[],resolved=new Set();
  while(pending.size){const ready=[...pending.values()].filter(op=>op.parents.every(p=>done.has(p))).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);if(!ready.length)throw Error('Jurnal Drive cu dependențe circulare.');
   // Select one at a time so arrival order can never determine the result.
   const op=ready[0];pending.delete(op.id);done.add(op.id);
   const stale=op.changes.some(c=>!C.equal(map[c.key]??null,c.before))||(op.resolves||[]).some(id=>!done.has(id)||id===op.id);
   if(stale){conflicts.push({...clone(op),reason:'Aceleași date au fost modificate pe alt dispozitiv.'});continue;}
   const candidate=clone(map);for(const c of op.changes){if(c.after===null)delete candidate[c.key];else candidate[c.key]=clone(c.after);}
   try{const state=C.inflate(candidate);validate(state);const actual=C.flatten(state);for(const c of op.changes)if(!C.equal(actual[c.key]??null,c.after))throw Error();map=actual;applied.push(op.id);for(const id of op.resolves||[])resolved.add(id);}
   catch(_){conflicts.push({...clone(op),reason:'Modificarea ar produce date incomplete sau un istoric invalid.'});}
  }
  const parented=new Set([...all.values()].flatMap(op=>op.parents)),heads=[...all.keys()].filter(k=>!parented.has(k)).sort();
  return {state:validate(C.inflate(map)),conflicts:conflicts.filter(op=>!resolved.has(op.id)),heads,applied,operations:[...all.values()]};
 }
 function operation(before,after,device,parents,operationId){const changes=C.diff(before,after);if(!changes.length)return null;if(!id(device)||!id(operationId))throw Error('Identificator local invalid.');return {id:operationId,device,parents:parents.slice(),changes};}
 const api={check,replay,operation};g.SalonDriveJournal=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
