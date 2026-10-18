// Disposable Windows QA only. Real installer/updater, synthetic local user data.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const root=process.env.QA_ROOT;
const ui=JSON.parse((await fs.readFile(path.join(root,'installer-ui-proof.json'),'utf8')).replace(/^\uFEFF/,''));
assert(ui.passed&&!ui.isolatedTest);
const dir=ui.installDirectory,exe=path.join(dir,'Chengjing-Retail.exe'),appDir=path.join(dir,'resources/app');
const require=createRequire(path.join(appDir,'package.json')),{_electron:electron}=require('playwright');
const final=JSON.parse(await fs.readFile('qa/installer-0164/candidate.json','utf8'));
const profile=path.join(process.env.APPDATA,'ChengjingRetail'),device=path.join(profile,'license/license-v1.json');
const report={passed:false,version:final.version,checks:ui.checks.slice(),actualGuiInstaller:true,metadataFixture:'none; real public application metadata, installer downloads and native updater',productionAccountsUsed:false,productionPaymentsMade:false};
const mark=name=>{report.checks.push(name);console.log('PASS '+name)},delay=ms=>new Promise(r=>setTimeout(r,ms));
const exists=p=>fs.access(p).then(()=>true,()=>false),hash=p=>fs.readFile(p).then(b=>createHash('sha256').update(b).digest('hex'));
let app;
function ps(command){const r=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:30000,env:{...process.env,QA_EXE:exe,QA_INSTALLDIR:dir}});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function stopAutoLaunch(){ps("Get-Process -Name 'Chengjing-Retail' -ErrorAction SilentlyContinue|Where-Object {$_.Path -eq $env:QA_EXE}|Stop-Process -Force");}
async function until(fn,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const r=await fn();if(r)return r;await delay(200)}throw Error('Windows acceptance timeout');}
async function launch(){const env={...process.env};delete env.CHENGJING_PROFILE_DIR;app=await electron.launch({executablePath:exe,env,timeout:30000});const page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.chengjing));const state=await until(async()=>{const s=await page.evaluate(()=>window.chengjing.state());return s.workspace&&s.license?.ready?s:false});return{page,state};}
async function close(){if(app){await app.close();app=null;}}
function setup(file){const r=spawnSync(file,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/CURRENTUSER','/DIR='+dir,'/LOG='+path.join(root,'lifecycle-'+Date.now()+'.log')],{encoding:'utf8',timeout:90000});assert.equal(r.status,0,r.stderr);}
async function uninstall(){const name=(await fs.readdir(dir)).find(n=>/^unins\d+\.exe$/i.test(n));assert(name,'Windows uninstaller not created');const r=spawnSync(path.join(dir,name),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART'],{encoding:'utf8',timeout:90000});assert.equal(r.status,0,r.stderr);assert.equal(await exists(exe),false);}
try{
 stopAutoLaunch();
 const reg=ps("$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{35C51D9F-5FEA-46E8-9A0D-A5BF802BCC7A}_is1';$v=Get-ItemProperty $k;@{version=$v.DisplayVersion;directory=$v.InstallLocation;uninstaller=[bool]$v.UninstallString}|ConvertTo-Json -Compress");
 const registration=JSON.parse(reg);assert.equal(registration.version,final.version);assert.equal(path.resolve(registration.directory),path.resolve(dir));assert(registration.uninstaller);mark('real Windows uninstall registration matches the selected directory and version');
 const desktop=ps("[Environment]::GetFolderPath('Desktop')"),programs=ps("[Environment]::GetFolderPath('Programs')"),shortcut='澄镜本地连接（会员版）.lnk';
 assert(await exists(path.join(desktop,shortcut)));assert(await exists(path.join(programs,shortcut)));mark('desktop and start-menu shortcuts are created by the normal installer');
 const first=await launch(),workspace=first.state.workspace,identity=await hash(device),witness=path.join(profile,'qa-install-settings.txt'),workFile=path.join(workspace,'qa-install-user-file.txt');
 await fs.writeFile(witness,'Synthetic preference, do not delete');await fs.writeFile(workFile,'Synthetic workspace file, do not delete');await close();
 // Inspect manual upgrade default without /DIR; cancel at the directory page.
 const check=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-File','qa/installer-0164/check-previous-dir.ps1','-Installer',path.join(root,'candidate.exe'),'-Expected',dir],{encoding:'utf8',timeout:35000});assert.equal(check.status,0,check.stdout+check.stderr);mark('manual upgrade directory page stays visible and defaults to the previous selected path');
 await uninstall();assert(await exists(device));assert(await exists(workFile));assert.equal(await hash(device),identity);assert.equal(await exists(path.join(desktop,shortcut)),false);assert.equal(await exists(path.join(programs,shortcut)),false);mark('uninstall removes application and shortcuts while preserving encrypted identity, settings and workspace');
 setup(path.join(root,'baseline.exe'));
 const previous=await launch();assert.equal((await previous.page.evaluate(()=>window.chengjing.supportState())).version,'0.16.3-retail.1');assert.equal(previous.state.workspace,workspace);assert.equal(await hash(device),identity);
 const catalog=await (await fetch('https://chengjingshop.top/api/applications')).json();const published=catalog.applications.find(a=>a.id==='chengjing-connect');assert.equal(published.version,final.version);assert.equal(published.package.sha256,final.sha256);
 await previous.page.locator('#support-update').click();await until(async()=>(await previous.page.evaluate(()=>window.chengjing.supportState())).update.phase==='available');
 await previous.page.locator('#support-download').click();await until(async()=>{const s=(await previous.page.evaluate(()=>window.chengjing.supportState())).update;if(s.phase==='error')throw Error(s.error);return s.phase==='ready'},160000);mark('genuine 0.16.3 UI downloads and verifies the candidate installer over public HTTPS');
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1})});
 const closed=new Promise(r=>previous.page.once('close',r));await previous.page.locator('#support-install').click();await Promise.race([closed,delay(35000).then(()=>{throw Error('Old UI failed to exit')})]);const driver=app.close().catch(()=>{});app=null;
 const result=await until(async()=>{try{return JSON.parse(await fs.readFile(path.join(profile,'updates/last-install.json'),'utf8'))}catch{return false}},150000);assert.equal(result.status,'success');assert.equal(result.version,final.version);assert([0,3010].includes(result.exitCode));
 await until(()=>Boolean(ps("$p=@(Get-Process -Name 'Chengjing-Retail' -ErrorAction SilentlyContinue|Where-Object {$_.Path -eq $env:QA_EXE -and $_.MainWindowHandle -ne 0});if($p.Count){'ready'}")));mark('native in-app update installs in the custom directory and automatically opens the new program');
 stopAutoLaunch();await Promise.race([driver,delay(10000)]);await delay(1000);
 assert.equal(JSON.parse(await fs.readFile(path.join(appDir,'package.json'),'utf8')).version,final.version);assert.equal(await hash(device),identity);assert.equal(await fs.readFile(witness,'utf8'),'Synthetic preference, do not delete');assert.equal(await fs.readFile(workFile,'utf8'),'Synthetic workspace file, do not delete');
 const updated=await launch();assert.equal(updated.state.workspace,workspace);assert.equal((await updated.page.evaluate(()=>window.chengjing.supportState())).version,final.version);await close();mark('updated application opens with the same identity, preferences, workspace and membership store');
 await uninstall();setup(path.join(root,'candidate.exe'));const reinstalled=await launch();assert.equal(reinstalled.state.workspace,workspace);assert.equal(await hash(device),identity);await close();mark('uninstall and reinstall preserve the same user identity and settings');
 report.installDirectory=dir;report.passed=true;
}catch(e){report.failure=String(e.stack||e);console.error(report.failure);process.exitCode=1;}
finally{await close().catch(()=>{});await fs.writeFile(path.join(root,'lifecycle-proof.json'),JSON.stringify(report,null,2));console.log('INSTALLER_REPORT_BEGIN\n'+JSON.stringify(report,null,2)+'\nINSTALLER_REPORT_END');if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,'```json\n'+JSON.stringify(report,null,2)+'\n```\n');}
