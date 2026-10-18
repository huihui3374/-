import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supportReport,checkRelease,ConnectionRecovery,MembershipConnectionGuard} from '../src/retail-support.js';

test('Support report cannot export secrets from connection, jobs, member or order state',()=>{
 const secret='private-do-not-export';const report=supportReport({version:'0.12.0-retail.1',platform:'win32 x64',connection:{phase:'ready',remoteUrl:secret,workspace:secret,verificationCode:secret,pendingJobs:[{arguments:secret}],recentJobs:[{result:{stdout:secret}}],permissions:{read:true,terminal:false},localCheck:{ok:true,code:'ok',stage:'completed',workspace:secret},verificationMatchedAt:Date.now()},license:{ready:true,authorized:true,account:secret,token:secret},purchase:{pending:{token:secret,needsPassword:true}}});
 assert(!JSON.stringify(report).includes(secret));assert.equal(report.connection.waitingApprovals,1);assert.equal(report.connection.webVerified,true);assert.equal(report.permissions.terminal,false);assert.equal(report.membership.needsPassword,true);
});
test('Update checks use only the store release and reject unsafe download origins',async()=>{
 const result={applications:[{id:'chengjing-connect',version:'0.12.0-retail.1',downloadUrl:'/downloads/apps/test/app.exe',package:{bytes:100,sha256:'a'.repeat(64)}}]},fetcher=async u=>{assert.equal(u,'https://chengjingshop.top/api/applications');return Response.json(result)};
 assert.equal((await checkRelease('0.11.0-retail.1',fetcher)).available,true);assert.equal((await checkRelease('0.12.0-retail.1',fetcher)).available,false);assert.equal((await checkRelease('0.13.0-retail.1',fetcher)).available,false);
 result.applications[0].downloadUrl='https://evil.test/fake.exe';await assert.rejects(checkRelease('0.11.0',fetcher),/安装包地址/);
 result.applications[0].downloadUrl='javascript:alert(1)';await assert.rejects(checkRelease('0.11.0',fetcher),/安装包地址/);
});
test('Recovery waits for consent on existing tasks and cancellation prevents a delayed reconnect',async()=>{
 let connect=0,stop=0,allow=false,release;
 const connector={snapshot:()=>({pendingJobs:[{}]}),stop:async()=>{stop++;await new Promise(r=>release=r)},connect:async()=>{connect++;return{phase:'ready'}}};
 const r=new ConnectionRecovery({connector,authorize:()=>{if(!allow)throw Error('expired')},confirm:async()=>false});
 await assert.rejects(r.run(),/expired/);allow=true;await r.run();assert.equal(stop,0);r.confirm=async()=>true;const waiting=r.run();await new Promise(r=>setImmediate(r));assert.equal(stop,1);r.cancel();release();await waiting;assert.equal(connect,0);
 connector.stop=async()=>{stop++};await r.run();assert.equal(connect,1);
});
test('Membership cleanup preserves a valid offline lease and stops an expired connection only once',async()=>{
 let allowed=true,stops=0,cancelled=0,release;
 const state={phase:'ready',running:true};
 const connector={snapshot:()=>state,stop:async()=>{stops++;await new Promise(r=>release=r);Object.assign(state,{phase:'idle',running:false})},update:v=>Object.assign(state,v)};
 const guard=new MembershipConnectionGuard({connector,license:{authorized:()=>allowed},beforeStop:()=>cancelled++});
 await guard.check();assert.equal(stops,0);
 allowed=false;const stopping=guard.check();const duplicate=guard.check();assert.equal(stops,1);assert.equal(cancelled,1);
 release();await Promise.all([stopping,duplicate]);assert.match(state.message,/任务已停止/);await guard.check();assert.equal(stops,1);
 // Renewal does not restart an old connection or reuse its access address.
 allowed=true;await guard.check();assert.equal(state.running,false);await guard.dispose();
});
test('Membership cleanup retries a failed stop, cancels an in-progress connection, and respects disposal',async()=>{
 let attempts=0,cancels=0;
 const state={phase:'connecting',running:false};
 const guard=new MembershipConnectionGuard({license:{authorized:()=>false},beforeStop:()=>cancels++,connector:{snapshot:()=>state,stop:async()=>{if(++attempts===1)throw Error('cleanup pending');Object.assign(state,{phase:'idle',running:false})},update:v=>Object.assign(state,v)}});
 await assert.rejects(guard.check(),/cleanup pending/);await guard.check();assert.equal(attempts,2);assert.equal(cancels,2);
 await guard.dispose();state.phase='connecting';await guard.check();assert.equal(attempts,2);
});
