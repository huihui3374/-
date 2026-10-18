// Disposable Windows VM only. No real customer accounts, payments or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const root=process.env.QA_ROOT,exe=process.env.QA_EXE,dir=path.dirname(exe),appRoot=path.join(dir,'resources/app');
const require=createRequire(path.join(appRoot,'package.json')),{_electron:electron}=require('playwright');
const profile=path.join(process.env.APPDATA,'ChengjingRetail'),device=path.join(profile,'license/license-v1.json');
const final=JSON.parse(await fs.readFile('qa/update-review/final.json','utf8')),candidate={version:'0.15.0-retail.1'};
const report={windows:os.release(),host:os.hostname(),baseline:'0.14.0-retail.2',simulatedOlderVersion:candidate.version,updaterScenario:'Only the installed package version is lowered on this disposable VM; all updater code and real production downloads are unchanged',final:final.version,checks:[],passed:false,realCustomerAccountsUsed:false,productionPaymentsMade:false};
let application;
const hash=p=>fs.readFile(p).then(b=>createHash('sha256').update(b).digest('hex'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const mark=name=>{report.checks.push(name);console.log('PASS '+name)};
async function until(fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await delay(200)}throw Error('Acceptance timeout');}
async function launch(){
 const env={...process.env};delete env.CHENGJING_PROFILE_DIR;
 application=await electron.launch({executablePath:exe,env,timeout:30000});const page=await application.firstWindow();
 await page.waitForFunction(()=>Boolean(window.chengjing));
 const state=await until(async()=>{const s=await page.evaluate(()=>window.chengjing.state());return s.workspace&&s.license?.ready?s:false});return{page,state};
}
async function close(){if(application){await application.close();application=null;}}
function install(file){const r=spawnSync(file,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/CURRENTUSER','/DIR='+dir,'/LOG='+path.join(root,'bootstrap.log')],{timeout:90000,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
try{
 const initial=await launch(),deviceHash=await hash(device),workspace=initial.state.workspace;
 const witness=path.join(profile,'qa-settings-witness.txt'),userFile=path.join(workspace,'qa-user-file.txt');
 await fs.writeFile(witness,'Keep synthetic preferences');await fs.writeFile(userFile,'Keep synthetic workspace');
 await close();install(path.join(root,'bootstrap.exe'));
 const metaFile=path.join(appRoot,'package.json'),metadata=JSON.parse(await fs.readFile(metaFile,'utf8'));assert.equal(metadata.version,final.version);metadata.version=candidate.version;await fs.writeFile(metaFile,JSON.stringify(metadata));
 assert.equal(await hash(device),deviceHash);assert.equal(await fs.readFile(witness,'utf8'),'Keep synthetic preferences');mark('real 0.14 to new bootstrap installation preserves default encrypted device identity and user data');
 await fs.mkdir(path.join(appRoot,'test'),{recursive:true});await fs.copyFile('qa/update-review/updater.test.js',path.join(appRoot,'test/updater.test.js'));
 const unit=spawnSync(process.execPath,['--test',path.join(appRoot,'test/updater.test.js')],{encoding:'utf8',timeout:30000});
 console.log(unit.stdout);assert.equal(unit.status,0,unit.stderr);mark('17 updater integrity, range, cancellation and version-order tests pass against the installed code on this Windows VM');
 const {page,state}=await launch();assert.equal(state.workspace,workspace);
 assert.equal((await page.evaluate(()=>window.chengjing.supportState())).version,candidate.version);
 const uiErrors=[];page.on('pageerror',e=>uiErrors.push(e.message));
 assert.equal(await page.locator('#remote-url').isVisible(),false);assert.equal(await page.locator('#perm-read').isVisible(),false);await page.locator('#permissions-settings>summary').click();assert(await page.locator('#perm-read').isVisible());await page.locator('#permissions-settings>summary').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);mark('customer interface hides technical fields, keeps permissions accessible and fits the desktop window');
 await page.locator('#support-update').click();
 await until(async()=>(await page.evaluate(()=>window.chengjing.supportState())).update.phase==='available');
 await page.locator('#support-download').click();
 await until(async()=>{const s=(await page.evaluate(()=>window.chengjing.supportState())).update;if(s.phase==='error')throw Error(s.error);return s.phase==='ready'},150000);
 assert.equal((await page.evaluate(()=>window.chengjing.supportState())).update.percent,100);assert(await page.locator('#support-install').isVisible());mark('actual packaged UI checks newer release, downloads over HTTPS, reports progress and verifies the real installer');
 await application.evaluate(({dialog})=>{dialog.showMessageBox=async(_win,options)=>{globalThis.qaUpdateDialog=options;return{response:0}}});
 await page.locator('#support-install').click();await until(()=>application.evaluate(()=>Boolean(globalThis.qaUpdateDialog)));await until(()=>page.locator('#support-install').isEnabled());
 assert.equal((await page.evaluate(()=>window.chengjing.supportState())).update.phase,'ready');
 assert.match((await application.evaluate(()=>globalThis.qaUpdateDialog)).detail,/账号、会员和工作区设置保留/);mark('cancel in the native installation confirmation leaves current program and verified download available');
 await application.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1})});
 // Release Playwright's Node inspector after the real window closes, otherwise Node waits for its debugger.
 const exited=new Promise(resolve=>page.once('close',resolve));
 await page.locator('#support-install').click();await Promise.race([exited,delay(25000).then(()=>{throw Error('Old window did not close gracefully')})]);const closingApplication=application;const driverClosing=closingApplication.close().catch(()=>{});application=null;
 const resultFile=path.join(profile,'updates/last-install.json');
 const result=await until(async()=>{try{return JSON.parse(await fs.readFile(resultFile,'utf8'))}catch{return false}},150000);
 assert.equal(result.status,'success');assert.equal(result.version,final.version);assert([0,3010].includes(result.exitCode));
 assert.equal(JSON.parse(await fs.readFile(path.join(appRoot,'package.json'),'utf8')).version,final.version);mark('verified installer runs after the old process exits and installs the expected version in the same directory');
 // Prove normal automatic relaunch before attaching a new Playwright session.
 const probe=await until(async()=>{
   const r=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop';$p=@(Get-Process -Name 'Chengjing-Retail' -ErrorAction SilentlyContinue|Where-Object {$_.MainWindowHandle -ne 0 -and $_.Path -eq $env:QA_EXE});if($p.Count -gt 0){@{ready=$true;count=$p.Count}|ConvertTo-Json -Compress}"],{env:{...process.env,QA_EXE:exe},encoding:'utf8',timeout:15000});
   return r.status===0&&r.stdout.trim()?JSON.parse(r.stdout):false;
 },30000);assert(probe.ready);report.automaticRelaunch=true;mark('new version automatically opens a real desktop window after installation');
 assert.equal(await hash(device),deviceHash);assert.equal(await fs.readFile(witness,'utf8'),'Keep synthetic preferences');assert.equal(await fs.readFile(userFile,'utf8'),'Keep synthetic workspace');
 assert.equal(await fs.access(path.join(profile,'updates',final.sha256,'setup.exe')).then(()=>true,()=>false),false);mark('successful upgrade removes its cached installer without deleting user data');
 // Stop only disposable QA processes after proving auto restart, then inspect the real new IPC/UI.
 const cleanup=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"Get-Process -Name 'Chengjing-Retail' -ErrorAction SilentlyContinue|Where-Object {$_.Path -eq $env:QA_EXE}|Stop-Process -Force"],{env:{...process.env,QA_EXE:exe},timeout:20000});assert.equal(cleanup.status,0);await Promise.race([driverClosing,delay(10000)]);await delay(1500);
 const upgraded=await launch();assert.equal((await upgraded.page.evaluate(()=>window.chengjing.supportState())).version,final.version);assert.equal(upgraded.state.workspace,workspace);assert.equal(await hash(device),deviceHash);mark('upgraded program opens with the same encrypted identity, preferences and workspace files');
 const finalState=await upgraded.page.evaluate(()=>window.chengjing.supportState());assert.equal(finalState.lastInstall.status,'success');
 assert.deepEqual(uiErrors,[]);report.defaultProfilePreserved=true;report.passed=true;await close();
}catch(error){report.failure=String(error.stack||error.message).replace(/https?:\/\/[^\s"']+/g,'[URL hidden]');console.error(report.failure);process.exitCode=1;}
finally{await close().catch(()=>{});console.log('UPDATE_REPORT_BEGIN\n'+JSON.stringify(report,null,2)+'\nUPDATE_REPORT_END');if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,'## In-app update acceptance\n```json\n'+JSON.stringify(report,null,2)+'\n```\n');}
