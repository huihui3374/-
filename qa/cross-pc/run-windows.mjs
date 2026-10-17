import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import {Readable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createFixture} from './protocol-fixture.mjs';
import {createHash} from 'node:crypto';

assert.equal(process.platform,'win32','This acceptance run requires a fresh Windows VM');
const phase=process.argv[2],root=process.env.QA_ROOT,exe=process.env.QA_EXE,appRoot=path.join(path.dirname(exe),'resources/app'),out=path.join(root,'reports'),handoff=path.join(root,'handoff'),profile=path.join(root,'profile-'+phase),workspace=path.join(root,'授权文件夹 with spaces');
await fs.mkdir(out,{recursive:true});await fs.mkdir(workspace,{recursive:true});await fs.mkdir(handoff,{recursive:true});
const download=JSON.parse(await fs.readFile(path.join(root,'download-evidence.json')));
const installation=JSON.parse((await fs.readFile(path.join(root,'installation-evidence.json'),'utf8')).replace(/^\uFEFF/,''));
const report={phase,download,installation,host:os.hostname(),windowsRelease:os.release(),architecture:os.arch(),version:'0.14.0-retail.2',checks:[],passed:false,realCustomersUsed:false,realPaymentsMade:false,productionConfigurationChanged:false,testLicenseService:'public disposable protocol simulator, NOT production backend',membershipPolicyProof:'reviewed production backend tested separately in private local environment'};
const mark=name=>{report.checks.push(name);console.log('PASS '+name)};
const clean=s=>String(s).replace(/https:\/\/[^\s"']*trycloudflare\.com[^\s"']*/g,'[private test connection]').replace(/\/mcp\/[A-Za-z0-9_-]+/g,'/mcp/[hidden]').replace(/Bearer\s+[A-Za-z0-9_-]+/g,'Bearer [hidden]');
const save=()=>fs.writeFile(path.join(out,phase+'.json'),JSON.stringify(report,null,2));
const originalConfig=await fs.readFile(path.join(appRoot,'retail-config.json'));
let application,page,client,publicClient,server,fixture;
const account='cross-pc-qa@example.invalid',password='QaPass8x',origin='https://localhost:3443';
const require=createRequire(path.join(appRoot,'package.json'));
const {_electron:electron}=require('playwright');
const {Client}=await import(pathToFileURL(path.join(appRoot,'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')));
const {StreamableHTTPClientTransport}=await import(pathToFileURL(path.join(appRoot,'node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js')));
const data=r=>{assert.notEqual(r.isError,true,'MCP rejected the operation');return JSON.parse(r.content.find(x=>x.type==='text').text)};
async function state(){return page.evaluate(()=>window.chengjing.state())}
async function wait(predicate,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const s=await state();if(await predicate(s))return s;await new Promise(r=>setTimeout(r,100))}throw Error('State condition timed out')}
async function login(){await page.locator('#license-account').fill(account);await page.locator('#license-password').fill(password);await page.locator('#license-submit').click()}
async function approved(name,args,decision='once'){
 const t=data(await client.callTool({name,arguments:args}));assert.equal(t.status,'awaiting_approval');
 await page.locator(`[data-job-id="${t.job_id}"]`).waitFor();
 await page.evaluate(({id,decision})=>window.chengjing.decideJob(id,decision),{id:t.job_id,decision});
 const end=Date.now()+20000;while(Date.now()<end){const job=data(await client.callTool({name:'get_job',arguments:{job_id:t.job_id}}));if(['completed','rejected','failed','cancelled'].includes(job.status)){assert.equal(job.status,decision==='reject'?'rejected':'completed');return job}await new Promise(r=>setTimeout(r,100))}throw Error('Original approved job timed out')
}
try{
 const expected=JSON.parse(await fs.readFile(new URL('./public-source-hashes.json',import.meta.url)));
 for(const [name,hash] of Object.entries(expected))assert.equal(createHash('sha256').update(await fs.readFile(path.join(appRoot,name))).digest('hex'),hash,'Installed program source differs: '+name);
 report.reviewedSourceFiles=Object.keys(expected).length;mark('actual installer installs the reviewed production application source unchanged');
 const check=spawnSync(exe,['--retail-self-check'],{encoding:'utf8',timeout:45000,env:{...process.env,CHENGJING_PROFILE_DIR:path.join(root,'pristine-self-check')}});assert.equal(check.status,0,'Pristine production package self-check failed: '+clean(check.stderr));const proof=JSON.parse(check.stdout.trim().split(/\r?\n/).find(l=>l.startsWith('{')));assert(proof.retailSelfCheck&&proof.pinnedServiceKey&&proof.windowsCredentialEncryption);assert.equal(proof.version,report.version);mark('pristine published executable, production service key and Windows DPAPI');
 if(phase==='second'){
  const prior=JSON.parse(await fs.readFile(path.join(process.env.QA_HANDOFF,'first-machine.json')));
  assert.notEqual(prior.host,os.hostname());mark('second independent Windows VM confirmed');
  fixture=createFixture(JSON.parse(await fs.readFile(path.join(process.env.QA_HANDOFF,'protocol-state.json'))));
 }else fixture=createFixture();
 server=https.createServer({pfx:await fs.readFile(path.join(root,'qa-localhost.pfx')),passphrase:'QA-only-ephemeral-certificate'},async(req,res)=>{try{
  if(req.url==='/qa/browser'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<label>QA name<input aria-label="QA name"></label><button onclick="document.querySelector(\'p\').textContent=\'Hello \'+document.querySelector(\'input\').value">Greet</button><p></p>');return}
  const chunks=[];for await(const b of req)chunks.push(b);const body=Buffer.concat(chunks),headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(', '):v);const response=await fixture.fetch(new Request(origin+req.url,{method:req.method,headers,...(body.length?{body}:{})}));res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
 }catch{res.writeHead(500);res.end('{"error":"Isolated fixture failed"}')}});await new Promise(r=>server.listen(3443,'127.0.0.1',r));
 await fs.writeFile(path.join(appRoot,'retail-config.json'),JSON.stringify({origin,publicKey:fixture.publicKey}));
 application=await electron.launch({executablePath:exe,env:{...process.env,CHENGJING_PROFILE_DIR:profile},timeout:25000});page=await application.firstWindow();await page.waitForFunction(()=>Boolean(window.chengjing));await wait(s=>s.workspace&&s.license?.ready);
 assert.equal((await application.evaluate(({app})=>app.isPackaged)),true);assert(await page.locator('#connect').isDisabled());assert.deepEqual(await page.evaluate(()=>({node:typeof require,process:typeof process})),{node:'undefined',process:'undefined'});assert.equal(await page.locator('#license-password').getAttribute('minlength'),'8');mark('clean packaged first launch, isolated renderer, 8-character password and no-member connection denial');
 if(phase==='second'){
  const encrypted=JSON.parse(await fs.readFile(path.join(process.env.QA_HANDOFF,'license-v1.json'),'utf8'));const canDecrypt=await application.evaluate(({safeStorage},value)=>{try{safeStorage.decryptString(Buffer.from(value,'base64'));return true}catch{return false}},encrypted.ciphertext);assert.equal(canDecrypt,false);mark('copied first-PC DPAPI profile cannot decrypt on second PC');
  await login();await page.waitForFunction(()=>document.getElementById('license-error').textContent.includes('其他电脑'));assert.equal((await state()).license.authorized,false);mark('same account denied on second PC while first PC remains bound');
  fixture.resetDevices();assert.equal(fixture.activeSessionCount(),0);mark('client accepts authorized transfer against synthetic protocol simulator');
 }
 await login();await wait(s=>s.license.authorized);await page.waitForFunction(()=>document.getElementById('license-password').value==='');assert.equal(await page.locator('#license-password').inputValue(),'');let row=fixture.account();assert.equal(fixture.activeDeviceCount(),1);mark('client login and device binding against synthetic protocol simulator');
 if(phase==='first'){assert.equal(row.expires_at-row.activated_at,7*86400000);const before=row.expires_at;fixture.grantDays(30);await page.evaluate(()=>window.chengjing.licenseRefresh());row=fixture.account();assert.equal(row.expires_at,before+30*86400000);mark('client accepts initial seven-day lease and thirty-day renewal from simulator')}
 await application.evaluate(({dialog},chosen)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[chosen]})},workspace);await page.locator('#choose').click();await wait(s=>path.resolve(s.workspace).toLowerCase()===path.resolve(workspace).toLowerCase());
 await page.locator('#connect').click();let live=await wait(s=>{if(s.phase==='error')throw Error('Connection start failed: '+clean(s.message));return s.phase==='ready'},90000);assert(live.localCheck?.ok);mark('real packaged MCP listener and bundled Cloudflare process start');
 const cfg=JSON.parse(await fs.readFile(path.join(profile,'bridge/config.json'),'utf8'));client=new Client({name:'independent-windows-qa',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+live.port+'/mcp/'+cfg.token)));assert.equal(client.getServerVersion().name,'chengjing-bridge');const catalog=await client.listTools();assert(catalog.tools.some(tool=>tool.name==='get_command_output'));
 const info=data(await client.callTool({name:'get_workspace_info',arguments:{verification_code:live.verificationCode}}));assert.equal(info.platform,'win32');assert.equal(info.instance_id,live.localCheck.workspace.instance_id);assert.equal(info.verification_code,live.verificationCode);assert.equal(info.shell.name,'PowerShell');mark('MCP initialize, catalog, current instance, verification code and PowerShell identity');
 assert.equal((await client.callTool({name:'run_command',arguments:{command:'Get-Date'}})).isError,true);mark('terminal denied before user grants permissions');
 await approved('write_file',{path:'approved.txt',content:'Independent Windows write/read check'});assert.equal(await fs.readFile(path.join(workspace,'approved.txt'),'utf8'),'Independent Windows write/read check');assert.equal((await client.callTool({name:'read_file',arguments:{path:'approved.txt'}})).content[0].text,'Independent Windows write/read check');await approved('write_file',{path:'rejected.txt',content:'must not exist'},'reject');await assert.rejects(fs.access(path.join(workspace,'rejected.txt')));mark('approved file work persists; rejected work never executes');
 for(const k of ['wholeComputer','network','browser','terminal'])await page.locator('#perm-'+k).check();await page.locator('#save-permissions').click();await wait(s=>s.permissions.terminal&&s.permissions.browser);
 const command=await approved('run_command',{command:"Write-Output 'cross-pc-output'; exit 7"});const output=data(await client.callTool({name:'get_command_output',arguments:{command_id:command.result.command_id}}));assert.equal(output.exitCode,7);assert.match(output.stdout,/cross-pc-output/);mark('actual Windows command stdout and nonzero exit code read back');
 await approved('browser_open',{url:origin+'/qa/browser'});await approved('browser_fill',{label:'QA name',value:'Chengjing'});await approved('browser_click',{role:'button',name:'Greet'});assert.match(data(await client.callTool({name:'browser_snapshot',arguments:{}})).snapshot,/Hello Chengjing/);const shot=await client.callTool({name:'browser_screenshot',arguments:{}});assert.equal(shot.content[0].type,'image');await client.callTool({name:'browser_close',arguments:{}});mark('independent Edge browser opens, fills, clicks, persists session and screenshots');
 try{await page.evaluate(()=>window.chengjing['check-public']());live=await state();assert(live.publicCheck?.ok);report.publicMcpReachable=true;mark('real public HTTPS tunnel MCP check')}catch(e){report.publicMcpReachable=false;report.publicMcpFailure=clean(e.message)}
 if(phase==='first'){
  await fs.copyFile(path.join(profile,'license/license-v1.json'),path.join(handoff,'license-v1.json'));await fs.writeFile(path.join(handoff,'protocol-state.json'),JSON.stringify(fixture.exportState()));await fs.writeFile(path.join(handoff,'first-machine.json'),JSON.stringify({host:os.hostname(),windowsRelease:os.release(),deviceCount:1}));
 }
 const pending=data(await client.callTool({name:'write_file',arguments:{path:'blocked-after-expiry.txt',content:'must never execute'}}));assert.equal(pending.status,'awaiting_approval');fixture.expire();await page.evaluate(()=>window.chengjing.licenseRefresh().catch(()=>{}));await wait(s=>!s.license.authorized);await page.evaluate(id=>window.chengjing.decideJob(id,'once').catch(()=>{}),pending.job_id);await assert.rejects(fs.access(path.join(workspace,'blocked-after-expiry.txt')));assert.equal((await client.callTool({name:'read_file',arguments:{path:'approved.txt'}})).isError,true);mark('expired membership blocks new operations and an earlier approval cannot bypass expiry');
 await page.locator('#disconnect').click();await wait(s=>s.phase==='idle'&&!s.running);await page.screenshot({path:path.join(out,phase+'.png')});mark('disconnect stops local connection');
 report.passed=true;
}catch(e){report.failure=clean(e.stack||e.message);console.error(report.failure);process.exitCode=1}
finally{
 try{await publicClient?.close();await client?.close()}catch{}
 try{if(application)await application.close()}catch{}
 try{await fs.writeFile(path.join(appRoot,'retail-config.json'),originalConfig)}catch{}
 if(server)await new Promise(r=>server.close(r));await save();
}
