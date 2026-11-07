(function (global) {
 'use strict';

 const maximumPrice=1000000;
 const maximumCents=maximumPrice*100;
 const MANUAL_PRICE_REASON='Preț stabilit manual în programare';
 const CATALOG_UPDATE_REASON='Actualizare denumire/preț din catalogul de servicii';
 const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const validId=value=>typeof value==='string'&&value.length>0&&value.length<=100;

 function clone(value){
  if(Array.isArray(value))return value.map(clone);
  if(isRecord(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)]));
  return value;
 }

 function validTimestamp(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
 }

 function requirePrice(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>maximumPrice)throw new Error('Prețul trebuie să fie între 0 și 1.000.000 lei.');
  return value;
 }

 function cents(value){
  requirePrice(value);
  // Shift the decimal representation before rounding each selected component,
  // as in financial reports: 1.005 becomes 101 bani rather than 100.
  const [coefficient,exponent='0']=value.toString().split('e');
  const result=Math.round(Number(coefficient+'e'+(Number(exponent)+2)));
  if(!Number.isSafeInteger(result))throw new Error('Prețul depășește intervalul acceptat.');
  return result;
 }

 function selectedCents(services){
  if(!Array.isArray(services))throw new Error('Serviciile programării nu sunt valide.');
  let total=0;
  for(const service of services){
   if(!isRecord(service))throw new Error('Serviciile programării nu sunt valide.');
   total+=cents(service.price);
   if(!Number.isSafeInteger(total))throw new Error('Totalul programării depășește intervalul acceptat.');
  }
  return total;
 }

 function selectedPrice(services){
  const total=selectedCents(services);
  if(total>maximumCents)throw new Error('Totalul programării depășește 1.000.000 lei.');
  return total/100;
 }

 function isManualPrice(appointment){
  if(!isRecord(appointment))throw new Error('Programarea nu este validă.');
  if(cents(appointment.price)!==selectedCents(appointment.services))return true;
  return (appointment.corrections||[]).some(entry=>{
   // Legacy edits may predate the explicit manual-price reason. Preserve every
   // audited price change unless it is a known automatic catalog update.
   if(entry?.reason===CATALOG_UPDATE_REASON||!isRecord(entry?.before)||!isRecord(entry?.after))return false;
   return cents(entry.before.price)!==cents(entry.after.price);
  });
 }

 function serviceValue(value,serviceId){
  if(!isRecord(value)||value.id!==serviceId||typeof value.name!=='string'||!value.name.trim()||value.name.length>150||typeof value.category!=='string'||value.category.length>100||typeof value.color!=='string'||!/^#[a-fA-F0-9]{6}$/.test(value.color)||typeof value.active!=='boolean')throw new Error('Serviciul modificat nu este valid.');
  return {id:serviceId,name:value.name.trim(),category:value.category,price:requirePrice(value.price),color:value.color,active:value.active};
 }

 function updateService(state,serviceId,value,at){
  if(!isRecord(state)||!Array.isArray(state.services)||!Array.isArray(state.appointments)||!validId(serviceId))throw new Error('Datele serviciilor nu sunt valide.');
  const matches=state.services.map((service,index)=>({service,index})).filter(item=>item.service?.id===serviceId);
  if(matches.length!==1||!isRecord(matches[0].service))throw new Error('Serviciul nu mai este disponibil.');
  const current=matches[0].service,nextValue=serviceValue(value,serviceId);
  const nameChanged=current.name!==nextValue.name,priceChanged=current.price!==nextValue.price;
  const next=clone(state),appointmentIds=[];
  Object.assign(next.services[matches[0].index],nextValue);
  if(!nameChanged&&!priceChanged)return {state:next,appointmentIds};

  for(const appointment of next.appointments){
   if(!isRecord(appointment)||!['pending','confirmed'].includes(appointment.status))continue;
   if(!Array.isArray(appointment.services))throw new Error('Serviciile programării nu sunt valide.');
   const selected=appointment.services.filter(service=>service?.serviceId===serviceId);
   if(!selected.length)continue;
   const manualPrice=priceChanged&&isManualPrice(appointment);
   let changed=false;
   for(const snapshot of selected){
    if(nameChanged&&snapshot.name!==nextValue.name){snapshot.name=nextValue.name;changed=true;}
    if(priceChanged&&!manualPrice&&snapshot.price!==nextValue.price){snapshot.price=nextValue.price;changed=true;}
   }
   // Manual totals and every saved component price remain together unchanged.
   // Retaining their old mismatch keeps inferred protection across later edits,
   // even when a new catalog price happens to equal the manual total.
   if(priceChanged&&!manualPrice){
    const total=selectedPrice(appointment.services);
    if(appointment.price!==total){appointment.price=total;changed=true;}
   }
   if(changed){
    if(!validId(appointment.id)||!validTimestamp(at))throw new Error('Actualizarea programării nu este validă.');
    appointment.updatedAt=at;
    appointmentIds.push(appointment.id);
   }
  }
  return {state:next,appointmentIds};
 }

 const api=Object.freeze({updateService,isManualPrice,MANUAL_PRICE_REASON,CATALOG_UPDATE_REASON,selectedPrice});
 global.SalonCatalog=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
