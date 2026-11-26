(function(g){
 'use strict';
 const LEASE='agenda.private-access.v1';
 let current=null,checking=false;
 const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
 function lock(message){
  current=null;
  for(const id of ['app','modal-root']){const n=document.getElementById(id);if(n)n.hidden=true;}
  let panel=document.getElementById('access-required');
  if(!panel){panel=document.createElement('section');panel.id='access-required';panel.style.cssText='font:17px/1.5 system-ui;max-width:520px;margin:10vh auto;padding:24px';document.body.append(panel);}
  const heading=document.createElement('h1');heading.textContent='Agenda Frizerie · Acces privat';
  const text=document.createElement('p');text.textContent=message;
  const link=document.createElement('a');link.href='/auth/google';link.textContent='Continuă cu Google';
  panel.replaceChildren(heading,text,link);
 }
 async function offlineUser(){
  const value=localStorage.getItem(LEASE);if(!value||!g.SalonAuthKey)throw Error('login');
  const parts=value.split('.');if(parts.length!==3)throw Error('lease');
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),payload=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if(header.alg!=='RS256'||payload.aud!==location.origin||!Number.isFinite(payload.exp)||payload.exp*1000<=Date.now()||!payload.sub||!payload.email)throw Error('expired');
  const key=await crypto.subtle.importKey('jwk',g.SalonAuthKey,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error('signature');
  return {user:{sub:payload.sub,email:payload.email,isAdmin:false},csrf:null,offline:true,leaseExpiresAt:payload.exp*1000};
 }
 async function open(){
  let response;
  try{response=await fetch('/api/session',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});}
  catch(_){
   try{current=await offlineUser();return current;}
   catch(_){lock('Este necesară conectarea online cu un cont Google aprobat. Datele locale nu au fost șterse.');return null;}
  }
  if(!response.ok){localStorage.removeItem(LEASE);lock(response.status===401||response.status===403?'Conectează-te online cu un cont Google aprobat pentru a continua.':'Serviciul privat nu este disponibil. Datele locale sunt păstrate.');return null;}
  const value=await response.json();
  if(!value.user?.sub||!value.csrf||!value.offlineLease)throw Error('Răspuns de autentificare invalid.');
  // Verify the permit before storing it; it is bound to this HTTPS origin.
  localStorage.setItem(LEASE,value.offlineLease);
  await offlineUser();
  current={...value,offline:false};return current;
 }
 async function api(path,{method='GET',body}={}){
  if(!path.startsWith('/api/'))throw Error('Adresă nevalidă.');
  if(!current)throw Error('Autentificare necesară.');
  const headers={};if(method!=='GET'){if(!current.csrf)throw Error('Conectează-te online pentru această operație.');headers['X-CSRF-Token']=current.csrf;headers['Content-Type']='application/json';}
  let response;try{response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(120000)});}catch(_){throw Error('Conexiunea nu este disponibilă. Datele locale rămân salvate.');}
  if(response.status===401){localStorage.removeItem(LEASE);lock('Sesiunea nu mai este valabilă. Conectează-te din nou cu Google.');}
  let result;try{result=await response.json();}catch(_){throw Error('Răspuns nevalid de la serviciul privat.');}
  if(!response.ok){const error=Error(result.error||'Operația nu a reușit.');error.code=result.code;throw error;}
  return result;
 }
 async function check(){
  if(checking||document.hidden||!current)return;checking=true;
  const sub=current.user.sub;
  try{const next=await open();if(next&&next.user.sub!==sub){lock('Contul s-a schimbat într-o altă fereastră. Reîncarcă pentru a deschide agenda contului nou.');}}
  catch(_){lock('Accesul nu poate fi verificat. Reîncarcă atunci când ai conexiune.');}
  finally{checking=false;}
 }
 async function logout(){await api('/api/logout',{method:'POST',body:{}});localStorage.removeItem(LEASE);lock('Contul a fost deconectat. Datele locale sunt păstrate separat pentru contul tău.');location.assign('/login');}
 g.PrivateAuth={open,api,logout,get:()=>current,lock};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
 g.addEventListener('online',check);g.addEventListener('pageshow',check);setInterval(check,120000);
})(window);
