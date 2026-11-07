(function(g){
 'use strict';
 const APP_NAME='agenda-frizerie-cloud';
 let auth=null,database=null,current=null,initializing=null,initBusy=false,actionBusy=false,lastError='';
 const config=()=>g.SalonFirebaseConfig||{};
 const validEmail=value=>typeof value==='string'&&value.trim().length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
 const matches=user=>!!user&&typeof user.uid==='string'&&!!user.uid&&validEmail(user.email);
 const configured=()=>config().enabled===true&&['apiKey','projectId','appId'].every(key=>typeof config().firebase?.[key]==='string'&&config().firebase[key].trim().length>0);
 function changed(){g.dispatchEvent(new Event('salon-firebase-changed'));}
 function problem(code){const error=new Error(message(code));error.code=code;return error;}
 function message(code){
  switch(code){
   case 'app/not-configured':case 'auth/invalid-api-key':case 'auth/app-not-authorized':case 'auth/unauthorized-domain':case 'auth/invalid-app-id':return 'Conectarea aplicației nu este configurată complet. Agenda locală este păstrată.';
   case 'app/sdk-unavailable':return 'Modulul de conectare nu s-a încărcat. Închide și redeschide aplicația.';
   case 'app/wrong-account':return 'Contul autentificat nu are o adresă de e-mail validă.';
   case 'app/busy':return 'O operație de conectare este deja în curs. Așteaptă finalizarea ei.';
   case 'app/offline':case 'auth/network-request-failed':return 'Nu există o conexiune disponibilă. Datele locale și conectarea salvată sunt păstrate pentru reîncercare.';
   case 'auth/invalid-login-credentials':case 'auth/invalid-credential':case 'auth/wrong-password':case 'auth/user-not-found':return 'Adresa sau parola aplicației nu este corectă. Folosește parola acestui cont din aplicație.';
   case 'auth/invalid-email':return 'Adresa de e-mail nu este validă.';
   case 'auth/email-already-in-use':return 'Există deja un cont pentru această adresă. Folosește Conectare sau resetarea parolei.';
   case 'auth/weak-password':case 'auth/password-does-not-meet-requirements':return 'Parola aplicației nu îndeplinește cerințele. Alege o parolă mai puternică.';
   case 'auth/too-many-requests':case 'auth/quota-exceeded':case 'resource-exhausted':return 'Au fost prea multe încercări sau limita gratuită a fost atinsă. Așteaptă și reîncearcă; agenda rămâne disponibilă local.';
   case 'auth/operation-not-allowed':return 'Conectarea prin e-mail și parolă nu este activată pentru aplicație.';
   case 'auth/user-disabled':return 'Contul aplicației este dezactivat. Agenda locală este păstrată.';
   case 'auth/user-token-expired':case 'auth/invalid-user-token':case 'auth/requires-recent-login':return 'Autorizarea aplicației a expirat sau s-a schimbat. Conectează-te din nou.';
   case 'auth/web-storage-unsupported':case 'auth/unsupported-persistence-type':return 'Dispozitivul nu a permis păstrarea conectării. Datele agendei sunt păstrate local.';
   case 'app/not-signed-in':return 'Conectează-te mai întâi la contul aplicației.';
   default:return 'Operația nu a fost finalizată. Verifică internetul și reîncearcă. Datele locale sunt păstrate.';
  }
 }
 function safeFailure(error){return problem(typeof error?.code==='string'?error.code:'app/operation-failed');}
 function connected(){return configured()&&matches(current)&&current.emailVerified===true;}
 function error(){if(lastError)return lastError;if(current&&!matches(current))return message('app/wrong-account');if(current&&current.emailVerified!==true)return 'Confirmă adresa din mesajul primit prin e-mail, apoi apasă Verifică confirmarea.';return '';}
 function online(){if(g.navigator?.onLine===false)return false;try{return g.GoogleDriveNative?.isOnline?g.GoogleDriveNative.isOnline()!==false:true;}catch(_){return false;}}
 function ready(){
  if(initializing)return initializing;
  if(!configured())return Promise.resolve(false);
  initBusy=true;changed();
  initializing=(async()=>{
   if(!g.firebase?.initializeApp||!g.firebase?.auth?.Auth?.Persistence?.LOCAL)throw problem('app/sdk-unavailable');
   const options=config().firebase;
   let app=g.firebase.apps?.find(value=>value.name===APP_NAME);
   if(app&&['apiKey','projectId','appId'].some(key=>app.options?.[key]!==options[key]))throw problem('app/not-configured');
   if(!app)app=g.firebase.initializeApp(options,APP_NAME);
   auth=app.auth();
   await auth.setPersistence(g.firebase.auth.Auth.Persistence.LOCAL);
   // SQLite/IndexedDB remains the offline business store. Firestore uses its
   // default memory cache; no second durable business queue is enabled here.
   database=app.firestore();
   await new Promise((resolve,reject)=>{
    let received=false;
    auth.onIdTokenChanged(user=>{current=user||null;changed();},failure=>{lastError=message(failure?.code);changed();});
    auth.onAuthStateChanged(user=>{current=user||null;changed();if(!received){received=true;resolve();}},failure=>{if(!received){received=true;reject(failure);}else{lastError=message(failure?.code);changed();}});
   });
   lastError='';return true;
  })().catch(failure=>{const safe=safeFailure(failure);lastError=safe.message;throw safe;}).finally(()=>{initBusy=false;changed();});
  // Initialization also runs at boot without a caller awaiting it. Attach a
  // rejection handler while retaining rejection for explicit ready() callers.
  initializing.catch(()=>{});
  return initializing;
 }
 function email(value){const result=typeof value==='string'?value.trim():'';if(!validEmail(result))throw problem('auth/invalid-email');return result;}
 function password(value){if(typeof value!=='string'||!value)throw problem('auth/invalid-credential');return value;}
 function requireUser(){const user=auth?.currentUser||current;if(!user)throw problem('app/not-signed-in');if(!matches(user))throw problem('app/wrong-account');return user;}
 async function perform(action,needsNetwork=true){
  if(actionBusy)throw problem('app/busy');
  actionBusy=true;lastError='';changed();
  try{if(!await ready())throw problem('app/not-configured');if(needsNetwork&&!online())throw problem('app/offline');return await action();}
  catch(failure){const safe=safeFailure(failure);lastError=safe.message;throw safe;}
  finally{actionBusy=false;changed();}
 }
 function signIn(address,secret){return perform(async()=>{const result=await auth.signInWithEmailAndPassword(email(address),password(secret));current=result.user||auth.currentUser||null;return current;});}
 function signUp(address,secret){return perform(async()=>{const result=await auth.createUserWithEmailAndPassword(email(address),password(secret));current=result.user||auth.currentUser||null;await requireUser().sendEmailVerification();return current;});}
 function verifyEmail(){return perform(async()=>{const user=requireUser();if(user.emailVerified!==true)await user.sendEmailVerification();return user.emailVerified===true;});}
 function checkVerification(){return perform(async()=>{const user=requireUser();await user.reload();current=auth.currentUser||user;if(!matches(current))throw problem('app/wrong-account');await current.getIdToken(true);return connected();});}
 function resetPassword(address){return perform(()=>auth.sendPasswordResetEmail(email(address)));}
 function signOut(){return perform(async()=>{await auth.signOut();current=null;return true;},false);}
 g.SalonFirebase={configured,ready,connected,user:()=>current,db:()=>database,online,isBusy:()=>initBusy||actionBusy,error,signIn,signUp,verifyEmail,checkVerification,resetPassword,signOut};
 g.addEventListener('online',changed);g.addEventListener('offline',changed);g.addEventListener('salon-network-changed',changed);
 if(config().enabled===true)ready().catch(()=>{});
})(window);
