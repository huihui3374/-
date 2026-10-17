// Standard advertised HTTP byte ranges; every response and the final hash is checked.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const [url,destination]=process.argv.slice(2),total=116968751,chunk=4*1024*1024;
const parsed=new URL(url);
if(parsed.origin!=='https://chengjingshop.top'||parsed.pathname!=='/downloads/apps/2813bda4-f1da-4db8-8664-b57a77fb1d11/Chengjing-Retail-Setup-0.14.0-retail.2-x64.exe')throw Error('Unexpected public installer URL');
const started=Date.now();
const handle=await fs.open(destination,'w+'),controller=new AbortController();
const deadline=setTimeout(()=>controller.abort(new Error('Range download exceeded 180 seconds')),180000);
let next=0,done=0;
await handle.truncate(total);
const workers=Array.from({length:8},async()=>{
 while(!controller.signal.aborted){
  const index=next++,start=index*chunk;
  if(start>=total)return;
  const end=Math.min(start+chunk,total)-1;
  let last;
  for(let attempt=0;attempt<2;attempt++){
   try{
    const response=await fetch(url,{headers:{Range:`bytes=${start}-${end}`},redirect:'error',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
    if(response.status!==206||response.headers.get('content-range')!==`bytes ${start}-${end}/${total}`)throw Error(`Range ${index}: HTTP ${response.status}, incorrect or absent Content-Range`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length!==end-start+1)throw Error(`Range ${index}: incomplete body`);
    let written=0;while(written<bytes.length){const result=await handle.write(bytes,written,bytes.length-written,start+written);if(!result.bytesWritten)throw Error('No write progress');written+=result.bytesWritten;}
    last=null;break;
   }catch(error){last=error;if(controller.signal.aborted)throw error;}
  }
  if(last)throw last;
  done++;if(done%20===0)console.log(`Verified ranges: ${done}/${Math.ceil(total/chunk)}`);
 }
});
try{
 await Promise.all(workers);await handle.sync();
}catch(error){controller.abort();await Promise.allSettled(workers);throw error;}
finally{clearTimeout(deadline);await handle.close();}
const hash=createHash('sha256');for await(const part of createReadStream(destination))hash.update(part);
if(hash.digest('hex')!=='78d931935a54855f28d0f6b5507783ecd5b4bdd3ada740e65b6fc8e89a9fe9f2')throw Error('Reassembled public ZIP failed SHA-256 verification');
await fs.writeFile(path.join(path.dirname(destination),'download-evidence.json'),JSON.stringify({publicInstaller:true,transport:'advertised HTTP byte ranges',bytes:total,sha256:'78d931935a54855f28d0f6b5507783ecd5b4bdd3ada740e65b6fc8e89a9fe9f2',elapsedMs:Date.now()-started}));
console.log('All advertised byte ranges assembled; original release SHA-256 verified');
