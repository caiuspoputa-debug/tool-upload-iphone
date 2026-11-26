/* Synthetic activation for feature tests. Keep the real receipt verifier and
 * boot gate; change only its verification public key in local asset responses.
 * The ephemeral private CryptoKey never leaves memory or enters browser code. */
'use strict';
const assert=require('node:assert/strict'),{webcrypto,randomUUID}=require('node:crypto');
const Activation=require('../docs/activation-client.js');
const encode=bytes=>Buffer.from(bytes).toString('base64url');
async function createActivationFixture(){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const publicKey=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
 let blockedRequests=0;
 function asset(name,bytes){
  if(!bytes||name.split(/[\\/]/).pop()!=='activation-client.js')return bytes;
  const source=bytes.toString('utf8');
  for(const axis of ['x','y'])assert.equal(source.split(Activation.CONFIG.publicKey[axis]).length,2,'exactly one configured public coordinate is replaced');
  return Buffer.from(source.replace(Activation.CONFIG.publicKey.x,publicKey.x).replace(Activation.CONFIG.publicKey.y,publicKey.y));
 }
 async function seed(context,{now=Date.now()}={}){
  const installationId=randomUUID(),issued=Math.floor(now/1000)-60;
  const claims={v:1,iss:Activation.CONFIG.issuer,aud:Activation.CONFIG.audience,installationId,platform:'web',iat:issued,exp:issued+Activation.MAX_LIFETIME};
  const payload=encode(Buffer.from(JSON.stringify(claims))),signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,Buffer.from(payload)),receipt=payload+'.'+encode(signature);
  await context.addInitScript(({installationKey,receiptKey,installationId,receipt})=>{
   if(!localStorage.getItem(installationKey)&&!localStorage.getItem(receiptKey)){
    localStorage.setItem(installationKey,installationId);localStorage.setItem(receiptKey,receipt);
   }
  },{installationKey:Activation.INSTALLATION_KEY,receiptKey:Activation.RECEIPT_KEY,installationId,receipt});
  await context.route(Activation.CONFIG.origin+'/**',route=>{blockedRequests++;return route.abort();});
 }
 return {asset,seed,assertNoServiceRequests:()=>assert.equal(blockedRequests,0,'preactivated feature tests never contact the activation service')};
}
module.exports={createActivationFixture};
