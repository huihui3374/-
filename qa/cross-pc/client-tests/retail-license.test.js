import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,createHash,sign,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {RetailLicense} from '../src/retail-license.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
function encryption(){const key=randomBytes(32);return{protect:text=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]).toString('base64')},unprotect:value=>{const bytes=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString()}}}
async function fixture(){
 const directory=await mkdtemp(path.join(tmpdir(),'cj-retail-')),pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'der'}).toString('base64'),crypt=encryption();
 let mono=0,wall=Date.now(),now=wall,offline=false,revoked=false,delay=null;
 const service={publicKey,async fetcher(url,opt){if(offline)throw Error('offline');const action=new URL(url).pathname.split('/').at(-1);if(action==='public-key')return new Response(JSON.stringify({publicKey:service.publicKey,serverTime:now}));if(delay&&action==='heartbeat')await delay;if(revoked)return new Response(JSON.stringify({error:'授权已到期',code:'LICENSE_EXPIRED'}),{status:403});if(action==='logout'||action==='password')return new Response('{"ok":true}');const data=JSON.parse(opt.body),claims={version:1,accountId:'fixture-account',account:data.account,deviceId:sha(data.publicKey),sessionId:'fixture-session',activatedAt:now,issuedAt:now,expiresAt:now+86400000,leaseExpiresAt:now+3600000};let payload=Buffer.from(JSON.stringify(claims)).toString('base64url');return new Response(JSON.stringify({token:'s'.repeat(43),account:{email:data.account},serverTime:now,lease:{payload,signature:sign(null,Buffer.from(payload),pair.privateKey).toString('base64url')}}))}};
 const options={directory,publicKey,fetcher:(...args)=>service.fetcher(...args),...crypt,monotonic:()=>mono,wallNow:()=>wall};const client=new RetailLicense(options);await client.initialize();
 return{client,options,service,directory,advance(ms){mono+=ms;wall+=ms;now+=ms},rollback(ms){wall-=ms},clockForward(ms){wall+=ms},offline(value){offline=value},revoke(){revoked=true},delay(value){delay=value},cleanup:()=>rm(directory,{recursive:true,force:true})};
}

test('Retail authorization uses signed device leases and never returns local secrets to its renderer',async()=>{
 const f=await fixture();try{
  assert.throws(()=>f.client.assertAllowed(),/授权/);
  await f.client.login({account:'buyer@qq.com',password:'Buyer-password-2026',activationCode:'CJ-fixture'});assert(f.client.authorized());
  const snapshot=JSON.stringify(f.client.snapshot());assert(!snapshot.includes('privateKey')&&!snapshot.includes('token')&&!snapshot.includes('signature'));
  const stored=await readFile(path.join(f.directory,'license-v1.json'),'utf8');assert(!stored.includes('PRIVATE KEY')&&!stored.includes('s'.repeat(43)));
  f.client.data.lease.signature='x'.repeat(86);assert(!f.client.authorized());assert.throws(()=>f.client.assertAllowed());
 }finally{await f.cleanup()}
});

test('Clock rollback cannot extend a running lease; a restart always requires fresh online verification',async()=>{
 const f=await fixture();try{
  await f.client.login({account:'buyer@qq.com',password:'Buyer-password-2026'});f.rollback(86400000);f.advance(3600001);assert(!f.client.authorized());
  f.offline(true);const restored=new RetailLicense(f.options);await restored.initialize();assert(!restored.authorized());
 }finally{await f.cleanup()}
});

test('Temporary network loss permits only the existing bounded lease; a definitive rejection immediately removes access',async()=>{
 const f=await fixture();try{
  await f.client.login({account:'buyer@qq.com',password:'Buyer-password-2026'});f.offline(true);await assert.rejects(f.client.refresh());assert(f.client.authorized());
  f.offline(false);f.revoke();await assert.rejects(f.client.refresh(),/授权已到期/);assert(!f.client.authorized());assert.equal(f.client.data.token,null);
 }finally{await f.cleanup()}
});

test('A copied encrypted profile cannot be opened with another machine protection key and is not overwritten',async()=>{
 const f=await fixture();try{
  await f.client.login({account:'buyer@qq.com',password:'Buyer-password-2026'});const before=await readFile(f.client.file);
  const other=new RetailLicense({...f.options,...encryption()});await assert.rejects(other.initialize(),/无法读取本机加密/);assert.deepEqual(await readFile(f.client.file),before);
 }finally{await f.cleanup()}
});

test('Late heartbeats cannot restore credentials after logout, and a different service key is rejected',async()=>{
 const f=await fixture();try{
  await f.client.login({account:'buyer@qq.com',password:'Buyer-password-2026'});
  let release;f.delay(new Promise(resolve=>release=resolve));const pending=f.client.refresh().catch(error=>error);await Promise.resolve();await f.client.logout();release();await pending;
  assert(!f.client.authorized());assert.equal(f.client.data.token,null);
  f.service.publicKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64');await assert.rejects(f.client.login({account:'buyer@qq.com',password:'Buyer-password-2026'}),/身份/);
 }finally{await f.cleanup()}
});
test('A local clock jump cannot extend a lease or poison the next online heartbeat timestamp',async()=>{
 const f=await fixture();try{
  await f.client.login({account:'buyer@qq.com',password:'Buyer-password-2026'});
  const expiresAt=f.client.snapshot().expiresAt,serviceNow=f.client.activeAnchor.serverTime;
  f.clockForward(86400000);assert.equal(f.client.authorized(),false);
  const original=f.service.fetcher;
  f.service.fetcher=async(url,opt)=>{if(url.endsWith('/heartbeat'))assert.equal(JSON.parse(opt.body).timestamp,serviceNow);return original(url,opt)};
  await f.client.refresh();assert.equal(f.client.authorized(),true);assert.equal(f.client.snapshot().expiresAt,expiresAt);
 }finally{await f.cleanup()}
});
