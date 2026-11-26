(function (global) {
 'use strict';

 const KINDS=['day','week','month','year'];
 const pad=n=>String(n).padStart(2,'0');
 const dateLabel=new Intl.DateTimeFormat('ro-RO',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
 const monthLabel=new Intl.DateTimeFormat('ro-RO',{month:'long',year:'numeric',timeZone:'UTC'});

 function requireKind(kind){if(!KINDS.includes(kind))throw new Error('Perioada trebuie să fie zi, săptămână, lună sau an.');}
 function dateKey(date){const year=date.getUTCFullYear();if(!Number.isFinite(date.getTime())||year<1||year>9999)throw new Error('Data este în afara intervalului acceptat.');return String(year).padStart(4,'0')+'-'+pad(date.getUTCMonth()+1)+'-'+pad(date.getUTCDate());}
 function parseDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Data trebuie să fie validă, în format AAAA-LL-ZZ.');const parsed=new Date(value+'T00:00:00.000Z');if(!Number.isFinite(parsed.getTime())||dateKey(parsed)!==value)throw new Error('Data trebuie să fie validă, în format AAAA-LL-ZZ.');return parsed;}
 function moveDays(date,count){const result=new Date(date.getTime());result.setUTCDate(result.getUTCDate()+count);dateKey(result);return result;}
 function monthDays(year,month){const last=new Date('2000-01-01T00:00:00.000Z');last.setUTCFullYear(year,month+1,0);return last.getUTCDate();}
 function weekDates(chosen){const year=chosen.getUTCFullYear(),start=new Date(chosen.getTime()),end=new Date(chosen.getTime());start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));end.setTime(start.getTime());end.setUTCDate(end.getUTCDate()+6);if(start.getUTCFullYear()!==year)start.setUTCFullYear(year,0,1);if(end.getUTCFullYear()!==year)end.setUTCFullYear(year,11,31);return {start,end};}
 function moveWeeks(chosen,delta){
  // Navigation visits the short periods beside New Year as separate segments.
  // Bound the explicit stepping work even if a caller supplies a huge integer.
  if(Math.abs(delta)>10000)throw new Error('Deplasarea depășește intervalul acceptat (maximum 10.000 de săptămâni).');
  let result=new Date(chosen.getTime());const direction=Math.sign(delta),full=bounds=>bounds.end.getTime()-bounds.start.getTime()===6*86400000;
  for(let step=0;step<Math.abs(delta);step++){
   const current=weekDates(result),adjacent=moveDays(direction>0?current.end:current.start,direction),next=weekDates(adjacent);
   result=full(current)&&full(next)?moveDays(result,direction*7):adjacent;
  }
  return result;
 }

 function periodBounds(kind,anchor){
  requireKind(kind);
  const chosen=parseDate(anchor),start=new Date(chosen.getTime()),end=new Date(chosen.getTime());
  let label;
  if(kind==='day')label=dateLabel.format(chosen);
  else if(kind==='week'){
   const clipped=weekDates(chosen);start.setTime(clipped.start.getTime());end.setTime(clipped.end.getTime());
   label=dateLabel.format(start)+' – '+dateLabel.format(end);
  }else if(kind==='month'){
   start.setUTCDate(1);end.setUTCDate(monthDays(chosen.getUTCFullYear(),chosen.getUTCMonth()));
   label=monthLabel.format(chosen);
  }else{
   start.setUTCMonth(0,1);end.setUTCMonth(11,31);label=String(chosen.getUTCFullYear());
  }
  return {start:dateKey(start),end:dateKey(end),label};
 }

 function shiftPeriod(kind,anchor,delta){
  requireKind(kind);
  const chosen=parseDate(anchor);
  if(!Number.isSafeInteger(delta))throw new Error('Deplasarea perioadei trebuie să fie un număr întreg.');
  if(kind==='day')return dateKey(moveDays(chosen,delta));
  if(kind==='week')return dateKey(moveWeeks(chosen,delta));
  const originalDay=chosen.getUTCDate();chosen.setUTCDate(1);
  if(kind==='month')chosen.setUTCMonth(chosen.getUTCMonth()+delta);
  else chosen.setUTCFullYear(chosen.getUTCFullYear()+delta);
  dateKey(chosen);
  chosen.setUTCDate(Math.min(originalDay,monthDays(chosen.getUTCFullYear(),chosen.getUTCMonth())));
  return dateKey(chosen);
 }

 // Shift the decimal representation before rounding each record. This avoids
 // binary floating-point surprises such as 10.075 * 100 becoming 1007.499… .
 function cents(amount){
  if(typeof amount!=='number'||!Number.isFinite(amount))throw new Error('Suma trebuie să fie un număr finit.');
  const [coefficient,exponent='0']=Math.abs(amount).toString().split('e');
  const value=Math.round(Number(coefficient+'e'+(Number(exponent)+2)))*(amount<0?-1:1);
  if(!Number.isSafeInteger(value))throw new Error('Suma depășește intervalul acceptat.');
  return value;
 }
 function sumCents(items,key){return items.reduce((total,item)=>{const next=total+cents(item[key]);if(!Number.isSafeInteger(next))throw new Error('Totalul depășește intervalul acceptat.');return next;},0);}

 function report(state,kind,anchor){
  const {start,end,label}=periodBounds(kind,anchor);
  if(!state||!Array.isArray(state.appointments)||(state.expenses!==undefined&&!Array.isArray(state.expenses)))throw new Error('Datele financiare nu sunt valide.');
  const within=item=>item&&typeof item.date==='string'&&item.date>=start&&item.date<=end;
  const appointments=state.appointments.filter(a=>a&&a.status==='completed'&&within(a));
  const expenses=(state.expenses||[]).filter(within).sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const revenueCents=sumCents(appointments,'price'),expenseCents=sumCents(expenses,'amount'),netCents=revenueCents-expenseCents;
  if(!Number.isSafeInteger(netCents))throw new Error('Rezultatul depășește intervalul acceptat.');
  const suppliers=new Map((state.suppliers||[]).map(x=>[x.id,x.name])),groups=new Map();
  expenses.forEach(x=>{const id=x.supplierId||null;if(!groups.has(id))groups.set(id,{id,name:id?(suppliers.get(id)||x.supplierName):'Fără furnizor',amountCents:0,count:0});const group=groups.get(id);group.amountCents+=cents(x.amount);group.count++;});
  const supplierTotals=Array.from(groups.values()).sort((a,b)=>b.amountCents-a.amountCents||a.name.localeCompare(b.name,'ro'));
  return {kind,start,end,label,revenueCents,expenseCents,netCents,appointmentCount:appointments.length,expenses,appointments,supplierTotals};
 }

 function monthlyEstimate(state,anchor){
  const {start,end,label}=periodBounds('month',anchor);
  if(!state||typeof state!=='object'||Array.isArray(state)||!Array.isArray(state.appointments))throw new Error('Datele financiare nu sunt valide.');
  const completed=[],active=[];
  for(const appointment of state.appointments){
   if(!appointment||!['completed','pending','confirmed'].includes(appointment.status))continue;
   if(typeof appointment.date!=='string'||appointment.date<start||appointment.date>end)continue;
   parseDate(appointment.date);
   // The saved booking price is authoritative, including the amount adjusted
   // at completion. Active bookings stay eligible throughout the selected month.
   if(appointment.status==='completed')completed.push(appointment);
   else active.push(appointment);
  }
  const completedCents=sumCents(completed,'price'),activeCents=sumCents(active,'price');
  const totalCents=completedCents+activeCents;
  if(!Number.isSafeInteger(totalCents))throw new Error('Totalul depășește intervalul acceptat.');
  return {start,end,label,completedCents,activeCents,totalCents,completedCount:completed.length,activeCount:active.length,totalCount:completed.length+active.length};
 }

 global.SalonFinance={periodBounds,report,shiftPeriod,monthlyEstimate};
})(typeof window!=='undefined'?window:globalThis);
