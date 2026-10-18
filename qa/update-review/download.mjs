import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
const [input,destination]=process.argv.slice(2),r=JSON.parse(await fs.readFile(input,'utf8'));
const u=new URL(r.downloadUrl,'https://chengjingshop.top');
if(u.origin!=='https://chengjingshop.top'||!u.pathname.startsWith('/downloads/apps/')||!u.pathname.endsWith('.exe')||!Number.isSafeInteger(r.bytes)||r.bytes>256*1024*1024||!/^[a-f0-9]{64}$/.test(r.sha256))throw Error('Invalid pinned test installer');
const handle=await fs.open(destination,'w'),chunk=4*1024*1024,controller=new AbortController();let next=0;
const timer=setTimeout(()=>controller.abort(),180000);
const jobs=Array.from({length:8},async()=>{
 while(true){const start=next++*chunk;if(start>=r.bytes)return;const end=Math.min(start+chunk,r.bytes)-1;
  const response=await fetch(u,{headers:{Range:`bytes=${start}-${end}`},redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
  if(response.status!==206||response.headers.get('content-range')!==`bytes ${start}-${end}/${r.bytes}`)throw Error('Range mismatch');
  const data=Buffer.from(await response.arrayBuffer());if(data.length!==end-start+1)throw Error('Incomplete range');
  let offset=0;while(offset<data.length){const result=await handle.write(data,offset,data.length-offset,start+offset);if(!result.bytesWritten)throw Error('Write failed');offset+=result.bytesWritten;}
 }
}).map(p=>p.catch(e=>{controller.abort();throw e}));
try{const outcomes=await Promise.allSettled(jobs),failure=outcomes.find(x=>x.status==='rejected');if(failure)throw failure.reason;await handle.sync()}finally{clearTimeout(timer);await handle.close()}
const hash=createHash('sha256');for await(const bytes of createReadStream(destination))hash.update(bytes);if(hash.digest('hex')!==r.sha256)throw Error('Pinned installer digest mismatch');console.log('Pinned installer downloaded and verified: '+r.version);
