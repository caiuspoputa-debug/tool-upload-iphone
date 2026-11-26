(function (global) {
 'use strict';

 const MAX_MINUTE=1440,MAX_DURATION=720;
 function finite(value,label){if(!Number.isFinite(value))throw new TypeError(label+' must be a finite number.');return value;}
 function appointmentStart(value){
  if(typeof value!=='string'||!/^\d{2}:\d{2}$/.test(value))throw new TypeError('Appointment start must use HH:mm.');
  const hour=Number(value.slice(0,2)),minute=Number(value.slice(3));
  if(hour>23||minute>59)throw new RangeError('Appointment start is outside the day.');
  return hour*60+minute;
 }
 function create({min,max,scale,minCardHeight,appointments=[]}={}){
  if(!Number.isInteger(min)||!Number.isInteger(max)||min<0||max>MAX_MINUTE||min>=max)throw new RangeError('Timeline bounds must be whole minutes within one day.');
  if(finite(scale,'Timeline scale')<=0||finite(minCardHeight,'Minimum card height')<=0)throw new RangeError('Timeline scale and minimum card height must be positive.');
  if(!Array.isArray(appointments))throw new TypeError('Appointments must be an array.');

  const length=max-min,events=Array.from({length:length+1},()=>[]),counts=new Uint32Array(MAX_DURATION+1),positions=new Float64Array(length+1);
  for(const appointment of appointments){
   // Cancelled appointments do not occupy the calendar or enlarge its timeline.
   if(appointment?.status==='cancelled'||appointment?.status==='canceled')continue;
   if(!appointment||typeof appointment!=='object')throw new TypeError('Appointment must be an object.');
   const start=appointmentStart(appointment.start),duration=appointment.duration,end=start+duration;
   if(!Number.isInteger(duration)||duration<5||duration>MAX_DURATION||end>MAX_MINUTE)throw new RangeError('Appointment duration must be 5–720 whole minutes within one day.');
   const visibleStart=Math.max(min,start),visibleEnd=Math.min(max,end);
   if(visibleStart>=visibleEnd)continue;
   events[visibleStart-min].push(duration);events[visibleEnd-min].push(-duration);
  }

  // A duration bucket avoids scanning every appointment for every minute.
  // At most 1,440 minutes and 720 duration buckets are examined, regardless
  // of the number of records from the displayed week.
  let shortest=MAX_DURATION+1;
  for(let index=0;index<length;index++){
   for(const change of events[index]){const duration=Math.abs(change);if(change>0){counts[duration]++;shortest=Math.min(shortest,duration);}else counts[duration]--;}
   while(shortest<=MAX_DURATION&&counts[shortest]===0)shortest++;
   const rate=shortest<=MAX_DURATION?Math.max(scale,(minCardHeight+4)/shortest):scale;
   positions[index+1]=positions[index]+rate;
  }
  const height=positions[length];
  function toY(minute){
   finite(minute,'Minute');
   if(minute<=min)return 0;if(minute>=max)return height;
   const offset=minute-min,index=Math.floor(offset);
   return positions[index]+(positions[index+1]-positions[index])*(offset-index);
  }
  function toMinute(y){
   finite(y,'Timeline position');
   if(y<=0)return min;if(y>=height)return max;
   let low=0,high=length;
   while(high-low>1){const middle=Math.floor((low+high)/2);if(positions[middle]<=y)low=middle;else high=middle;}
   return min+low+(y-positions[low])/(positions[high]-positions[low]);
  }
  function cardHeight(startMinute,duration){
   finite(startMinute,'Appointment start');finite(duration,'Appointment duration');
   if(duration<=0)throw new RangeError('Appointment duration must be positive.');
   return Math.max(minCardHeight,toY(startMinute+duration)-toY(startMinute)-4);
  }
  return Object.freeze({toY,toMinute,height,cardHeight});
 }
 const api=Object.freeze({create});
 global.SalonTimeline=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
