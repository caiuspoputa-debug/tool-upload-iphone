(function(global){
 'use strict';
 const DEFAULT_LOGO='',MAX_FILE_BYTES=8*1024*1024,MAX_PIXELS=20000000;
 const TYPES=['image/png','image/jpeg','image/webp'];
 function create(hooks){
  const doc=hooks.document||global.document,win=hooks.window||global;
  let busy=false,message='',failed=false;
  const current=()=>hooks.getLogo()||DEFAULT_LOGO;
  const custom=()=>typeof hooks.getLogo()==='string'&&!!hooks.getLogo();
  function imageFrom(file){
   return new Promise((resolve,reject)=>{
    const url=win.URL.createObjectURL(file),image=new win.Image();let settled=false;
    const finish=(error)=>{if(settled)return;settled=true;win.clearTimeout(timeout);image.onload=image.onerror=null;win.URL.revokeObjectURL(url);if(error)reject(error);else resolve(image);};
    const timeout=win.setTimeout(()=>finish(Error('Imaginea nu a putut fi deschisă la timp. Alege alt fișier.')),15000);
    image.onload=()=>finish();image.onerror=()=>finish(Error('Fișierul nu este o imagine validă.'));image.src=url;
   });
  }
  async function prepare(file){
   if(!file||!TYPES.includes(file.type))throw Error('Alege o imagine PNG, JPG sau WEBP.');
   if(!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_FILE_BYTES)throw Error('Imaginea trebuie să aibă cel mult 8 MB.');
   const image=await imageFrom(file),width=image.naturalWidth,height=image.naturalHeight;
   if(!width||!height||width*height>MAX_PIXELS)throw Error('Imaginea este prea mare. Alege un logo de cel mult 20 megapixeli.');
   // Persist only decoded, bounded PNG pixels: original metadata and animation are omitted.
   for(const edge of [512,384,256,128]){
    const ratio=Math.min(1,edge/Math.max(width,height)),canvas=doc.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
    const context=canvas.getContext('2d');if(!context)throw Error('Imaginea nu poate fi pregătită pe acest dispozitiv.');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL('image/png');canvas.width=canvas.height=1;
    if(hooks.validateLogo(data))return data;
   }
   throw Error('Logo-ul nu a putut fi pregătit. Alege o imagine mai simplă.');
  }
  function renderSettings(){
   const el=hooks.el,button=hooks.button;
   const source=current(),preview=el('img',{src:source||null,hidden:source?null:true,alt:'Previzualizarea logo-ului frizeriei','data-salon-logo':'',width:1280,height:1280});
   const file=el('input',{type:'file',accept:TYPES.join(','),'data-logo-file':'','aria-label':'Alege imaginea pentru logo',class:'logo-file-input'});
   const feedback=el('p',{class:'logo-feedback'+(failed?' logo-error':''),role:'status','aria-live':'polite'},message);
   const showMessage=(value,error=false)=>{message=value;failed=error;feedback.textContent=message;feedback.classList.toggle('logo-error',failed);};
   const setBusy=value=>{busy=value;upload.disabled=busy;reset.disabled=busy||!custom();};
   const upload=button(custom()?'Schimbă logo':'Încarcă logo',()=>{if(busy)return;file.value='';file.click();},'btn',{'data-logo-upload':'',disabled:busy});
   const reset=button('Șterge logo-ul',()=>{
    if(busy||!custom())return;
    hooks.confirm('Șterge logo-ul','Schimbarea logo-ului se va sincroniza cu celelalte dispozitive conectate.',async()=>{
     if(busy)return;
     setBusy(true);showMessage('Se șterge logo-ul…');
     try{
      if(!await hooks.saveLogo(null))throw Error('Logo-ul nu a putut fi salvat. Imaginea anterioară este păstrată.');
      showMessage('');setBusy(false);hooks.onSaved?.('Logo-ul a fost șters.');
     }catch(error){showMessage(error?.message||'Logo-ul nu a putut fi salvat. Imaginea anterioară este păstrată.',true);}
     finally{setBusy(false);}
    },'Șterge logo-ul');
   },'btn secondary',{'data-logo-reset':'',disabled:busy||!custom()});
   const card=el('section',{class:'card logo-settings'},el('h2',{},'Logo-ul frizeriei'),
    el('div',{class:'logo-settings-content'},el('div',{class:'logo-preview'},preview),el('div',{class:'logo-settings-copy'},
     el('p',{class:'setting-label'},'Imaginea afișată în dreapta sus'),
     el('p',{class:'setting-desc'},'Încarcă un logo PNG, JPG sau WEBP, de cel mult 8 MB. Imaginea își păstrează proporțiile și se salvează în agenda frizeriei, inclusiv în backup.'),
     el('p',{class:'setting-desc'},'Logo-ul se păstrează după actualizare și se transmite prin sincronizare Firebase pe celelalte dispozitive conectate la aceeași agendă.'),
     el('div',{class:'logo-actions'},upload,reset),feedback)),file);
   file.addEventListener('change',async()=>{
    const chosen=file.files?.[0];if(!chosen||busy)return;
    setBusy(true);showMessage('Se pregătește logo-ul…');
    try{
     const data=await prepare(chosen);
     showMessage('Se salvează logo-ul…');
     if(!await hooks.saveLogo(data))throw Error('Logo-ul nu a putut fi salvat. Imaginea anterioară este păstrată.');
     showMessage('');setBusy(false);hooks.onSaved?.('Logo salvat. Se va sincroniza cu celelalte dispozitive conectate.');
    }catch(error){showMessage(error?.message||'Imaginea nu a putut fi încărcată.',true);}
    finally{file.value='';setBusy(false);}
   });
   return card;
  }
  return {current,renderSettings,isBusy:()=>busy,prepare};
 }
 const api={create,DEFAULT_LOGO,MAX_FILE_BYTES,MAX_PIXELS};global.SalonLogoUI=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
