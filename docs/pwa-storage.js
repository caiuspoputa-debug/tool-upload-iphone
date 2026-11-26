(function(g){
'use strict';
let DB='agenda-frizerie-v1';
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
let db,cache=null,revision=0,writing=false,conflict=false;
async function open(options={}){
 if(options.accountId){if(!/^[A-Za-z0-9_-]{1,200}$/.test(options.accountId))throw Error('Cont nevalid.');DB='agenda-frizerie-user-'+options.accountId;}
 if(db)return;
 db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('bundles');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Închide celelalte ferestre ale agendei și reîncearcă.'));});
 db.onversionchange=()=>{db.close();conflict=true;};
 const row=await new Promise((resolve,reject)=>{const t=db.transaction('bundles'),r=t.objectStore('bundles').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 if(row){if(!Number.isSafeInteger(row.revision)||!row.bundle||!row.bundle.state)throw Error('Datele locale nu pot fi citite. Nu au fost șterse.');cache=clone(row.bundle);revision=row.revision;}
 else if(!options.accountId) {const raw=localStorage.getItem('atelier.sync.bundle.v1'),legacy=localStorage.getItem('atelier.salon.v1');if(raw||legacy){const b=raw?JSON.parse(raw):{state:JSON.parse(legacy),device:null};if(!b.state)throw Error('Backup local invalid.');if(!await writeBundle(b.state,b.device))throw Error('Migrarea datelor nu a reușit. Originalul este păstrat.');}}
}
function writeBundle(state,device){
 if(!db||writing||conflict)return Promise.resolve(false);
 let proposal;try{proposal=clone({state,device});}catch(_){return Promise.resolve(false);}writing=true;
 return new Promise(resolve=>{let success=false;let t;try{t=db.transaction('bundles','readwrite');const s=t.objectStore('bundles'),r=s.get('current');r.onsuccess=()=>{if((r.result?.revision||0)!==revision){conflict=true;t.abort();return;}if(r.result)s.put(r.result,'previous');s.put({revision:revision+1,bundle:proposal},'current');success=true;};t.oncomplete=()=>{if(success){revision++;cache=proposal;queueMicrotask(()=>g.dispatchEvent(new Event('salon-storage-committed')));}writing=false;resolve(success);};t.onabort=t.onerror=()=>{writing=false;resolve(false);};}catch(_){writing=false;resolve(false);}});
}
g.SalonStorage={open,readBundle:()=>clone(cache),writeBundle,isWriting:()=>writing,hasConflict:()=>conflict};
})(window);