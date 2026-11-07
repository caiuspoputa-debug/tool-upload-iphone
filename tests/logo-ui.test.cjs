'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Logo=require('../docs/logo.js');
class Element{
 constructor(tag,attrs={},children=[]){this.tag=tag;this.attrs=attrs;Object.assign(this,attrs);this.children=children.filter(x=>x!=null);this.events={};this.textContent=children.filter(x=>typeof x==='string').join('');this.classes=new Set((attrs.class||'').split(/\s+/));this.classList={toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)};}
 addEventListener(name,fn){this.events[name]=fn;}
 click(){this.clicks=(this.clicks||0)+1;if(this.onclick)return this.onclick();}
}
const walk=node=>[node,...(node.children||[]).flatMap(x=>typeof x==='object'?walk(x):[])];
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}){
 let value=options.initial,manager,root,callbacks=0;
 const calls={saves:[],saved:[],images:[],revoked:[],canvas:[],confirm:[]},timers=new Map();let seq=0;
 const doc={createElement(tag){assert.equal(tag,'canvas');const canvas={width:0,height:0,getContext(type){assert.equal(type,'2d');if(options.noContext)return null;return{drawImage(image,x,y,w,h){calls.canvas.push({image,x,y,w,h});}};},toDataURL(type){assert.equal(type,'image/png');return 'encoded-png-'+this.width+'x'+this.height;}};return canvas;}};
 class Image{
  constructor(){this.naturalWidth=options.width??1200;this.naturalHeight=options.height??600;calls.images.push(this);}
  set src(url){this.source=url;if(options.holdDecode)return;queueMicrotask(()=>options.invalidImage?this.onerror?.():this.onload?.());}
 }
 const win={Image,URL:{createObjectURL:()=> 'blob:fixture-'+(++seq),revokeObjectURL:url=>calls.revoked.push(url)},setTimeout:(fn,delay)=>{const id=++seq;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)};
 const el=(tag,attrs,...children)=>new Element(tag,attrs,children.flat());
 manager=Logo.create({document:doc,window:win,getLogo:()=>value,validateLogo:options.validateLogo||(()=>true),el,
  button:(label,fn,cls='btn',attrs={})=>el('button',{class:cls,onclick:fn,...attrs},label),
  confirm:(title,message,fn,label)=>calls.confirm.push({title,message,fn,label}),
  saveLogo:async data=>{calls.saves.push(data);const result=options.save?await options.save(data):true;if(result)value=data;return result;},
  onSaved:message=>{calls.saved.push({message,busy:manager.isBusy()});callbacks++;if(options.rerenderOnSave)root=manager.renderSettings();}
 });
 root=manager.renderSettings();
 const find=key=>walk(root).find(n=>Object.hasOwn(n.attrs,key));
 return{manager,calls,timers,get value(){return value;},get callbacks(){return callbacks;},get root(){return root;},input:()=>find('data-logo-file'),upload:()=>find('data-logo-upload'),reset:()=>find('data-logo-reset'),feedback:()=>walk(root).find(n=>n.attrs.class?.includes('logo-feedback')),change(file){const input=find('data-logo-file');input.files=file?[file]:[];return input.events.change();}};
}
const file={type:'image/png',size:1200};

test('logo preparation rejects unsupported and unbounded files before decoding',async()=>{
 const h=harness();
 for(const item of [null,{type:'image/svg+xml',size:1},{type:'text/plain',size:10},{type:'image/png',size:0},{type:'image/jpeg',size:Logo.MAX_FILE_BYTES+1},{type:'image/png',size:1.5}])await assert.rejects(h.manager.prepare(item));
 assert.equal(h.calls.images.length,0);assert.equal(h.calls.revoked.length,0);
});

test('decoded logo is resized proportionally and re-encoded into bounded PNG pixels',async()=>{
 const h=harness();assert.equal(await h.manager.prepare({type:'image/jpeg',size:1200}),'encoded-png-512x256');
 assert.deepEqual(h.calls.canvas.map(({x,y,w,h})=>({x,y,w,h})),[{x:0,y:0,w:512,h:256}]);
 assert.equal(h.calls.revoked.length,1);assert.equal(h.timers.size,0);
 const small=harness({width:32,height:48});assert.equal(await small.manager.prepare(file),'encoded-png-32x48');
});

test('preparation retries smaller encodings and fails visibly if every result is rejected',async()=>{
 const h=harness({validateLogo:value=>value==='encoded-png-256x128'});
 assert.equal(await h.manager.prepare({type:'image/webp',size:900}),'encoded-png-256x128');
 assert.deepEqual(h.calls.canvas.map(x=>x.w),[512,384,256]);
 const bad=harness({validateLogo:()=>false});await assert.rejects(bad.manager.prepare(file),/imagine mai simplă/);assert.deepEqual(bad.calls.canvas.map(x=>x.w),[512,384,256,128]);
});

test('invalid dimensions, decode failure and timeout release resources without saving',async()=>{
 for(const opts of [{width:0},{width:5001,height:4000},{invalidImage:true},{noContext:true}]){const h=harness(opts);await assert.rejects(h.manager.prepare(file));assert.equal(h.calls.revoked.length,1);assert.equal(h.calls.saves.length,0);}
 const h=harness({holdDecode:true}),pending=h.manager.prepare(file),timer=[...h.timers.values()][0];
 assert.equal(timer.delay,15000);timer.fn();await assert.rejects(pending,/la timp/);assert.equal(h.calls.revoked.length,1);assert.equal(h.timers.size,0);
});

test('upload waits for durable asynchronous save, blocks duplicate actions and re-renders enabled controls',async()=>{
 const save=deferred(),h=harness({save:()=>save.promise,rerenderOnSave:true});
 assert.equal(h.manager.current(),'');assert.equal(h.reset().disabled,true);
 const pending=h.change(file);await tick();
 assert.equal(h.manager.isBusy(),true);assert.equal(h.upload().disabled,true);assert.equal(h.reset().disabled,true);assert.equal(h.callbacks,0);assert.equal(h.calls.saves.length,1);
 h.upload().click();await h.change(file);assert.equal(h.calls.saves.length,1,'another choice cannot overwrite the pending durable save');
 save.resolve(true);await pending;
 assert.equal(h.manager.current(),'encoded-png-512x256');assert.equal(h.manager.isBusy(),false);assert.equal(h.callbacks,1);assert.equal(h.calls.saved[0].busy,false,'onSaved may immediately rebuild the Settings card');
 assert.equal(h.upload().disabled,false);assert.equal(h.reset().disabled,false);assert.equal(h.upload().textContent,'Schimbă logo');
});

test('cancelled picker and failed uploads preserve the previous logo and allow retry',async()=>{
 const h=harness({initial:'previous-logo',save:async()=>false});await h.change();assert.equal(h.calls.images.length,0);assert.equal(h.calls.saves.length,0);
 await h.change(file);assert.equal(h.value,'previous-logo');assert.equal(h.callbacks,0);assert.equal(h.manager.isBusy(),false);assert.match(h.feedback().textContent,/anterioară este păstrată/);assert.equal(h.feedback().classes.has('logo-error'),true);assert.equal(h.upload().disabled,false);assert.equal(h.reset().disabled,false);
 const rejected=harness({initial:'previous-logo',save:async()=>{throw Error('Stocarea nu este disponibilă.');}});await rejected.change(file);assert.equal(rejected.value,'previous-logo');assert.match(rejected.feedback().textContent,/Stocarea nu este disponibilă/);assert.equal(rejected.callbacks,0);
});

test('reset requires confirmation and awaits durable removal before switching to default',async()=>{
 const save=deferred(),h=harness({initial:'custom-logo',save:()=>save.promise,rerenderOnSave:true});h.reset().click();
 assert.equal(h.calls.saves.length,0);assert.equal(h.calls.confirm.length,1);assert.equal(h.value,'custom-logo');
 const pending=h.calls.confirm[0].fn();await tick();
 assert.deepEqual(h.calls.saves,[null]);assert.equal(h.manager.isBusy(),true);assert.equal(h.value,'custom-logo');assert.equal(h.callbacks,0);
 save.resolve(true);await pending;assert.equal(h.manager.current(),'');assert.equal(h.reset().disabled,true);assert.equal(h.upload().disabled,false);assert.equal(h.callbacks,1);assert.equal(h.calls.saved[0].busy,false);
});

test('failed or rejected reset keeps the custom logo, reports error and releases controls',async()=>{
 for(const save of [async()=>false,async()=>{throw Error('Salvare indisponibilă.');}]){
  const h=harness({initial:'custom-logo',save});h.reset().click();await h.calls.confirm[0].fn();assert.equal(h.value,'custom-logo');assert.equal(h.manager.isBusy(),false);assert.equal(h.callbacks,0);assert.equal(h.upload().disabled,false);assert.equal(h.reset().disabled,false);assert.equal(h.feedback().classes.has('logo-error'),true);
 }
});


test('new logo state has a blank preview without an empty document URL',()=>{const h=harness(),preview=walk(h.root).find(n=>Object.hasOwn(n.attrs,'data-salon-logo'));assert.equal(Logo.DEFAULT_LOGO,'');assert.equal(h.manager.current(),'');assert.equal(preview.attrs.src,null);assert.equal(preview.attrs.hidden,true);assert.equal(h.reset().disabled,true);});
