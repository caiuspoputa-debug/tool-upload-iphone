(function (global) {
 'use strict';

 // Romanian Orthodox national red-letter feasts, not a complete daily
 // synaxarion or a list of public holidays. Sources and coverage are recorded
 // in work/orthodox-holidays-sources-2026-2027.txt. All calculations use UTC
 // solely for civil-date arithmetic, independently of the device time zone.
 const supportedYears=Object.freeze([2026,2027]);
 const empty=Object.freeze([]);
 const fixedFeasts=[
  ['01-01','Tăierea împrejur a Domnului; Sfântul Vasile cel Mare'],
  ['01-06','Botezul Domnului (Boboteaza)'],
  ['01-07','Sfântul Ioan Botezătorul'],
  ['01-30','Sfinții Trei Ierarhi'],
  ['02-02','Întâmpinarea Domnului'],
  ['03-25','Buna Vestire'],
  ['04-23','Sfântul Gheorghe'],
  ['05-21','Sfinții Constantin și Elena'],
  ['06-24','Nașterea Sfântului Ioan Botezătorul (Sânzienele)'],
  ['06-29','Sfinții Apostoli Petru și Pavel'],
  ['07-20','Sfântul Proroc Ilie'],
  ['08-06','Schimbarea la Față a Domnului'],
  ['08-15','Adormirea Maicii Domnului'],
  ['08-29','Tăierea capului Sfântului Ioan Botezătorul'],
  ['09-08','Nașterea Maicii Domnului'],
  ['09-14','Înălțarea Sfintei Cruci'],
  ['10-01','Acoperământul Maicii Domnului'],
  ['10-14','Sfânta Cuvioasă Parascheva'],
  ['10-26','Sfântul Dimitrie, Izvorâtorul de Mir'],
  ['10-27','Sfântul Dimitrie cel Nou'],
  ['11-08','Sfinții Arhangheli Mihail și Gavriil'],
  ['11-21','Intrarea în biserică a Maicii Domnului'],
  ['11-30','Sfântul Apostol Andrei'],
  ['12-06','Sfântul Nicolae'],
  ['12-07','Sfânta Muceniță Filofteia'],
  ['12-25','Nașterea Domnului (Crăciunul)'],
  ['12-26','Soborul Maicii Domnului'],
  ['12-27','Sfântul Arhidiacon Ștefan']
 ];
 const paschalFeasts=[
  [-7,'Intrarea Domnului în Ierusalim (Floriile)'],
  [0,'Învierea Domnului (Sfintele Paști)'],
  [1,'A doua zi de Paști'],
  [2,'A treia zi de Paști'],
  [5,'Izvorul Tămăduirii'],
  [39,'Înălțarea Domnului'],
  [49,'Pogorârea Sfântului Duh (Rusaliile)'],
  [50,'Sfânta Treime']
 ];
 const dateIndex=Object.create(null);
 const yearIndex=Object.create(null);
 const dayMilliseconds=86400000;

 function dateKey(date){
  return date.getUTCFullYear()+'-'+String(date.getUTCMonth()+1).padStart(2,'0')+'-'+String(date.getUTCDate()).padStart(2,'0');
 }

 function orthodoxPascha(year){
  // Julian computus, converted to the Gregorian civil date. The calendar
  // difference is 13 days throughout the explicitly supported 2026–2027.
  const a=year%4,b=year%7,c=year%19;
  const d=(19*c+15)%30,e=(2*a+4*b-d+34)%7;
  const month=Math.floor((d+e+114)/31),day=(d+e+114)%31+1;
  return Date.UTC(year,month-1,day+13);
 }

 for(const year of supportedYears){
  const dates=Object.create(null);
  function add(date,name,kind){
   if(!dates[date])dates[date]=[];
   dates[date].push(Object.freeze({name,kind}));
  }
  for(const [monthDay,name] of fixedFeasts)add(year+'-'+monthDay,name,'fixed');
  const pascha=orthodoxPascha(year);
  for(const [offset,name] of paschalFeasts)add(dateKey(new Date(pascha+offset*dayMilliseconds)),name,'paschal');
  yearIndex[year]=Object.freeze(Object.keys(dates).sort().map(date=>{
   const holidays=Object.freeze(dates[date]);
   dateIndex[date]=holidays;
   return Object.freeze({date,holidays});
  }));
 }
 Object.freeze(dateIndex);
 Object.freeze(yearIndex);

 function forDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return empty;
  const year=Number(value.slice(0,4));
  if(!supportedYears.includes(year))return empty;
  const month=Number(value.slice(5,7)),day=Number(value.slice(8,10));
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day)return empty;
  return dateIndex[value]||empty;
 }

 function forYear(year){
  return Number.isInteger(year)&&supportedYears.includes(year)?yearIndex[year]:empty;
 }

 const api=Object.freeze({forDate,forYear,supportedYears});
 global.SalonHolidays=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
