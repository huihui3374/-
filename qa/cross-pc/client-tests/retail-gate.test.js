import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access,cp,writeFile,symlink,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createAssistant} from '../src/server.js';
import {MembershipConnectionGuard} from '../src/retail-support.js';

test('The server enforces a license before work and again after approval, while identity and cleanup remain available',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cj-gate-'));let allowed=false,assistant,client;
 const token=randomBytes(32).toString('hex');
 try{
  assistant=await createAssistant({workspace:root,port:0,token,permissions:{read:true,write:true},authorizeUse:()=>{if(!allowed)throw Error('授权已到期')}});
  client=new Client({name:'license-gate-test',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+assistant.port+'/mcp/'+token)));
  const call=(name,args={})=>client.callTool({name,arguments:args});
  assert(!(await call('get_workspace_info')).isError);assert.equal((await call('write_file',{path:'denied.txt',content:'must not write'})).isError,true);
  assert.equal((await call('browser_screenshot')).isError,true);
  allowed=true;const request=await call('write_file',{path:'pending.txt',content:'must not write after expiry'}),job=JSON.parse(request.content[0].text);assert.equal(job.status,'awaiting_approval');
  allowed=false;await assistant.decideJob(job.job_id,'once').catch(()=>{});
  const status=JSON.parse((await call('get_job',{job_id:job.job_id})).content[0].text);assert(['failed','rejected','awaiting_approval'].includes(status.status));
  await assert.rejects(access(path.join(root,'pending.txt')));assert(!(await call('get_workspace_info')).isError);
 }finally{await client?.close();await assistant?.close();await rm(root,{recursive:true,force:true})}
});

test('A shipped retail manifest rejects both standalone-server and unlicensed connector entry points',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'cj-shipped-gate-'));
 try{
  await cp(new URL('../src/',import.meta.url),path.join(directory,'src'),{recursive:true});
  await writeFile(path.join(directory,'package.json'),JSON.stringify({type:'module',version:'0.10.0-retail.1',chengjingEdition:'retail'}));
  await symlink(fileURLToPath(new URL('../node_modules/',import.meta.url)),path.join(directory,'node_modules'),process.platform==='win32'?'junction':'dir');
  const script=`import assert from 'node:assert/strict';import {createAssistant} from './src/server.js';import {BridgeConnector} from './src/bridge-connector.js';const root=${JSON.stringify(directory)};await assert.rejects(createAssistant({workspace:root,token:'x'.repeat(64),port:0}),/授权版必须/);const config={workspace:root,token:'x'.repeat(64),pluginName:'fixture'};const bridge=new BridgeConnector({load:async()=>config,persist:async()=>config,save:async()=>config});await bridge.initialize(root);await assert.rejects(bridge.connect(),/授权版登录/);`;
  const run=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:directory,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 }finally{await rm(directory,{recursive:true,force:true})}
});
test('Lease expiry terminates a real owned background process and cancels outstanding approvals',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cj-expiry-process-')),token=randomBytes(32).toString('hex');
 let allowed=true,assistant,client;
 try{
  assistant=await createAssistant({workspace:root,port:0,token,approvalPolicies:{command:'always'},permissions:{read:true,write:true,wholeComputer:true,terminal:true,network:true},authorizeUse:()=>{if(!allowed)throw Error('会员已到期')}});
  client=new Client({name:'expiry-cleanup-test',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+assistant.port+'/mcp/'+token)));
  const call=async(name,args)=>JSON.parse((await client.callTool({name,arguments:args})).content[0].text);
  const filename=path.join(root,'owned.pid'),code=`require("node:fs").writeFileSync(${JSON.stringify(filename)},String(process.pid));setInterval(()=>{},1000)`;
  const quote=process.platform==='win32'?value=>"'"+value.replaceAll("'","''")+"'":value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
  // Windows PowerShell 5 reparses quotes passed to native executables. Use its
  // encoded command for the child fixture, so this tests lifetime, not -e quoting.
  const childScript="[IO.File]::WriteAllText('"+filename.replaceAll("'","''")+"',[string]$PID); Start-Sleep -Seconds 300";
  const command=process.platform==='win32'?"& powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand "+Buffer.from(childScript,'utf16le').toString('base64'):quote(process.execPath)+' -e '+quote(code);
  const launch=await call('start_process',{command,cwd:root});assert.equal(launch.status,'queued');
  let pid;
  for(let i=0;i<1000;i++){
   const job=assistant.recentJobs().find(j=>j.job_id===launch.job_id);
   assert.notEqual(job?.status,'failed','Fixture launch failed: '+JSON.stringify(job));
   if(job?.status==='completed'){
    const output=await call('get_command_output',{command_id:job.result.id});
    assert.equal(output.running,true,'Fixture process exited before cleanup: '+JSON.stringify(output));
   }
   try{pid=Number(await readFile(filename,'utf8'));if(pid)break}catch{}
   await new Promise(r=>setTimeout(r,20));
  }
  assert(Number.isInteger(pid)&&pid>0,'Fixture background process did not start');assert.doesNotThrow(()=>process.kill(pid,0));
  const pending=await call('write_file',{path:'must-not-exist.txt',content:'denied after expiry'});assert.equal(pending.status,'awaiting_approval');
  const state={running:true,phase:'ready'},connector={snapshot:()=>state,stop:async()=>{await assistant.close();Object.assign(state,{running:false,phase:'idle'})},update:v=>Object.assign(state,v)};
  const guard=new MembershipConnectionGuard({connector,license:{authorized:()=>allowed}});allowed=false;await guard.check();
  assert.equal(assistant.recentJobs().find(j=>j.job_id===pending.job_id).status,'cancelled');
  await assert.rejects(access(path.join(root,'must-not-exist.txt')));
  let alive=true;for(let i=0;i<250;i++){
   try{process.kill(pid,0);if(process.platform==='linux'&&/\) Z /.test(await readFile('/proc/'+pid+'/stat','utf8'))){alive=false;break}}
   catch(error){if(['ESRCH','ENOENT'].includes(error.code)){alive=false;break}throw error}
   await new Promise(r=>setTimeout(r,20));
  }
  assert.equal(alive,false,'Expired member left a background process running');await guard.dispose();
 }finally{await client?.close();await assistant?.close();await rm(root,{recursive:true,force:true})}
});
