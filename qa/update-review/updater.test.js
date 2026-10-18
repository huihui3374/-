import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import versions from '../desktop/version.cjs';
import { validateRelease, RetailUpdater } from '../src/retail-updater.js';
const payload = Buffer.alloc(5 * 1024 * 1024, 87); payload.write('MZ');
const sha256 = createHash('sha256').update(payload).digest('hex');
const release = { id:'chengjing-connect', version:'0.15.1-retail.1', downloadUrl:'/downloads/apps/123/test.exe', package:{bytes:payload.length,sha256} };
async function fixture(t, transform = response => response) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chengjing-updater-'));
  t.after(() => fs.rm(directory, {recursive:true,force:true}));
  const fetcher = async (url, options = {}) => {
    if (url.endsWith('/api/applications')) return Response.json({applications:[release]});
    assert.equal(options.redirect, 'error');assert.equal(options.cache,'no-store');
    const [,a,b] = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range), start = +a, end = +b;
    return transform(new Response(payload.subarray(start,end+1), {status:206,headers:{'content-range':`bytes ${start}-${end}/${payload.length}`,'content-length':String(end-start+1)}}),options);
  };
  const updater = new RetailUpdater({currentVersion:'0.15.0-retail.1',directory,fetcher});
  await updater.check();return {updater,directory};
}
for (const [a,b,expected] of [
  ['0.15.0-retail.1','0.14.0-retail.2',1], ['0.15.0-retail.10','0.15.0-retail.2',1],
  ['0.15.0','0.15.0-retail.2',1], ['0.15.0-alpha.9','0.15.0-alpha.10',-1],
  ['0.15.0+build.1','0.15.0+build.9',0], ['0.15.0-retail','0.15.0-retail.1',-1],
  ['0.14.9','0.15.0-retail.1',-1]
]) test(`version ordering ${a} / ${b}`,()=>assert.equal(versions.compareVersions(a,b),expected));
test('invalid versions cannot trigger an upgrade',()=>{for(const s of ['01.0.0','1.2.3-01','1.2','9'.repeat(1000)])assert(!versions.newerVersion(s,'0.15.0'))});
test('release prohibits other hosts, executable schemes, query strings and ZIP files',()=>{
  for(const downloadUrl of ['https://evil.test/a.exe','javascript:alert(1)','/downloads/apps/a.zip','/downloads/apps/a.exe?key=private','/downloads/apps/%2fa.exe'])
    assert.throws(()=>validateRelease({...release,downloadUrl},'0.14.0'));
});
test('missing hash, impossible sizes and downgrades cannot install',()=>{
  for(const pkg of [{bytes:10},{bytes:-2,sha256},{bytes:600*1024*1024,sha256}])assert.throws(()=>validateRelease({...release,package:pkg},'0.14.0'));
  assert.equal(validateRelease(release,'0.16.0').available,false);
});
test('concurrent range download verifies bytes, progress, magic and final hash',async t=>{
  const {updater}=await fixture(t);const events=[];updater.on('change',s=>events.push(s));
  await updater.download();assert.equal(updater.snapshot().phase,'ready');assert.equal(updater.snapshot().percent,100);
  assert.deepEqual(await fs.readFile((await updater.verifiedInstaller()).file),payload);
  assert(events.some(e=>e.phase==='verifying'));assert(!('file' in updater.snapshot()));
});
test('tampering after download is caught before installer execution',async t=>{
  const {updater}=await fixture(t);await updater.download();const {file}=await updater.verifiedInstaller();await fs.writeFile(file,'MZbroken');
  await assert.rejects(updater.verifiedInstaller(),/校验/);assert.equal(updater.snapshot().phase,'error');
});
test('wrong range headers are rejected without leaving a partial installer',async t=>{
  const {updater,directory}=await fixture(t,()=>new Response(payload,{status:200}));
  await assert.rejects(updater.download());assert.equal(updater.file,null);assert.equal(updater.snapshot().phase,'error');
  assert.deepEqual(await fs.readdir(path.join(directory,sha256)),[]);
});
test('bad checksum is never promoted to an executable',async t=>{
  const {updater,directory}=await fixture(t);updater.release.sha256='a'.repeat(64);
  await assert.rejects(updater.download(),/校验/);assert.equal(updater.file,null);assert.deepEqual(await fs.readdir(path.join(directory,'a'.repeat(64))),[]);
});
test('cancel aborts workers, cleans partial files and allows retry',async t=>{
  let calls=0;const {updater,directory}=await fixture(t,async(response,options)=>{
    calls++;if(calls<=2)await new Promise((resolve,reject)=>{if(options.signal.aborted)return reject(options.signal.reason);options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})});return response;
  });
  const pending=updater.download();while(calls<2)await new Promise(r=>setTimeout(r,5));
  await assert.rejects(updater.check(),/正在更新/);await assert.rejects(updater.download(),/正在更新/);
  updater.cancel();await pending;assert.equal(updater.snapshot().phase,'available');assert.deepEqual(await fs.readdir(path.join(directory,sha256)),[]);
  await updater.download();assert.equal(updater.snapshot().phase,'ready');
});
test('no-newer-version cannot be downloaded or installed',async t=>{
  const {updater}=await fixture(t);updater.currentVersion='0.16.0';await updater.check();assert.equal(updater.snapshot().phase,'latest');
  await assert.rejects(updater.download());await assert.rejects(updater.verifiedInstaller());
});
test('failed recheck clears a previously available installer and stale version',async t=>{
  const {updater}=await fixture(t);assert.equal(updater.snapshot().phase,'available');
  updater.fetcher=async()=>{throw Error('offline')};await assert.rejects(updater.check());
  assert.equal(updater.snapshot().version,null);assert.equal(updater.release,null);
  await assert.rejects(updater.download());await assert.rejects(updater.verifiedInstaller());
});
