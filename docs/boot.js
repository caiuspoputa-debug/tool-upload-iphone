window.SalonBootReady=(async()=>{try{
 if(!window.SalonActivation?.ensure)throw Error('Modulul de activare nu s-a încărcat. Verifică actualizarea aplicației.');
 if(!await window.SalonActivation.ensure({view:document.getElementById('app')}))return;
 // Dependencies execute only after activation, including providers which may
 // initialize authentication or read preferences as soon as their script loads.
 const dependencies=['gestures.js','finance.js','pwa-storage.js','pwa-shell.js','google-config.js','direct-drive.js','sync.js','drive-journal.js','drive-sync-ui.js','vendor/firebase-app-compat.js','vendor/firebase-auth-compat.js','vendor/firebase-firestore-compat.js','firebase-config.js','firebase-account.js','firebase-transport.js','firebase-sync-ui.js','timeline.js','holidays.js','catalog.js','cloud-backup.js','legacy-logo.js','logo.js'];
 const loadScript=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(Error('O componentă a aplicației nu s-a încărcat. Verifică internetul și reîncearcă.'));document.body.append(script);});
 for(const src of dependencies)await loadScript(src);
 await SalonStorage.open();
 await loadScript('app.js');
 await window.SalonAppReady;
 SalonPWA.start({getCanReload:()=>SalonAppLifecycle.canReload()&&!SalonCloud.isBusy()});
 await SalonCloud.start({getState:()=>SalonStorage.readBundle()?.state,canBackup:()=>SalonAppLifecycle.canReload(),validate:SalonCore.validateState,restore:json=>window.restoreBackup(json),clearDraft:()=>SalonAppLifecycle.clearSettingsDraft()});
}catch(e){document.getElementById('app').textContent='Agenda nu a pornit. Datele existente sunt păstrate. '+e.message;}})();
