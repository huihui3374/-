// Public QA: only a disposable Windows VM's synthetic files and profile are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const root=process.env.QA_ROOT,exe=process.env.QA_EXE,dir=path.dirname(exe),installer=path.join(root,'published-setup.exe');
const appRoot=path.join(dir,'resources/app'),require=createRequire(path.join(appRoot,'package.json'));
const {_electron:electron}=require('playwright');
const profile=path.join(process.env.APPDATA,'ChengjingRetail');
const report={version:'0.14.0-retail.2',windows:process.getSystemVersion?.()||process.platform,checks:[],passed:false,productionAccountsChanged:false,productionPaymentsMade:false};
const mark=name=>{report.checks.push(name);console.log('PASS '+name)};
const exists=p=>fs.access(p).then(()=>true,()=>false),hash=p=>fs.readFile(p).then(x=>createHash('sha256').update(x).digest('hex'));
let application;
async function launch(){
 const env={...process.env};delete env.CHENGJING_PROFILE_DIR;
 application=await electron.launch({executablePath:exe,env,timeout:30000});
 const page=await application.firstWindow();await page.waitForFunction(()=>Boolean(window.chengjing));
 const end=Date.now()+20000;
 while(Date.now()<end){
  const state=await page.evaluate(()=>window.chengjing.state());
  if(state.workspace&&state.license?.ready)return {page,state};
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw Error('Default profile/workspace initialization did not complete within 20 seconds');
}
async function close(){if(application){await application.close();application=null;}}
function install(){
 const r=spawnSync(installer,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/CURRENTUSER','/DIR='+dir,'/LOG='+path.join(root,'review-reinstall.log')],{encoding:'utf8',timeout:90000});
 assert.equal(r.status,0,'Reinstall returned a failure or timed out');
}
try{
 assert.equal(process.platform,'win32');
 const signatures=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $items=@($env:QA_INSTALLER,$env:QA_EXE)|ForEach-Object{$s=Get-AuthenticodeSignature -LiteralPath $_; @{file=[IO.Path]::GetFileName($_);status=[string]$s.Status;hasSigningCertificate=($null -ne $s.SignerCertificate)}}; $items|ConvertTo-Json -Compress"],{encoding:'utf8',timeout:25000,env:{...process.env,QA_INSTALLER:installer}});
 if(signatures.status===0)report.authenticode=JSON.parse(signatures.stdout.trim());else report.authenticodeInspectionError={exitCode:signatures.status,stderr:signatures.stderr};
 const registrations=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop';$rows=@(); foreach($hive in @('HKCU','HKLM')){foreach($base in @('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')){Get-ItemProperty \"${hive}:\\$base\\*\" -ErrorAction SilentlyContinue|Where-Object {$_.DisplayName -match '澄镜|Chengjing' -or $_.InstallLocation -eq $env:QA_INSTALLDIR}|ForEach-Object {$rows+=@{hive=$hive;displayName=$_.DisplayName;displayVersion=$_.DisplayVersion;publisher=$_.Publisher;hasUninstallCommand=([bool]$_.UninstallString)}}}};ConvertTo-Json -InputObject $rows -Compress"],{encoding:'utf8',timeout:25000,env:{...process.env,QA_INSTALLDIR:dir}});
 if(registrations.status===0)report.uninstallRegistration=JSON.parse(registrations.stdout.trim());else report.registrationInspectionError={exitCode:registrations.status,stderr:registrations.stderr};console.log('Metadata inspection completed; any inspection errors are recorded separately');
 const {state}=await launch();report.defaultProfileReady=true;assert(!state.license.authorized);assert.equal(await exists(path.join(profile,'license/license-v1.json')),true);mark('fresh launch creates a real default Windows profile and encrypted device identity');
 const deviceFile=path.join(profile,'license/license-v1.json'),deviceHash=await hash(deviceFile),sentinel=path.join(state.workspace,'qa-preserve-user-file.txt');
 await fs.writeFile(sentinel,'Synthetic user file; retain during reinstall and uninstall');
 const witness=path.join(profile,'qa-preserve-settings.txt');await fs.writeFile(witness,'Synthetic user preference witness');
 await close();install();assert.equal(await hash(deviceFile),deviceHash);assert(await exists(witness));assert(await exists(sentinel));mark('same-version overwrite installation retains default encrypted identity, preferences and workspace files');
 const reopened=await launch();assert.equal(reopened.state.workspace,state.workspace);assert(reopened.state.license.ready);assert.equal(await hash(deviceFile),deviceHash);await close();mark('after overwrite, actual program launches with the same default workspace and device identity');
 const uninstaller=path.join(dir,(await fs.readdir(dir)).find(n=>/^unins\d+\.exe$/i.test(n))||'missing-uninstaller');
 const un=spawnSync(uninstaller,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LOG='+path.join(root,'review-uninstall.log')],{encoding:'utf8',timeout:90000});
 assert.equal(un.status,0,'Uninstaller failed or timed out');assert.equal(await exists(exe),false);report.uninstall={exitCode:un.status,programRemoved:true,defaultProfileRetained:await exists(profile),encryptedDeviceIdentityRetained:await exists(deviceFile),workspaceFileRetained:await exists(sentinel)};
 assert(report.uninstall.defaultProfileRetained&&report.uninstall.encryptedDeviceIdentityRetained&&report.uninstall.workspaceFileRetained);mark('uninstall removes executable and keeps default user profile and workspace files');
 install();assert.equal(await hash(deviceFile),deviceHash);const reinstalled=await launch();assert(reinstalled.state.license.ready);assert.equal(reinstalled.state.workspace,state.workspace);await close();mark('reinstall after uninstall restores launch without replacing the encrypted device identity');
 report.passed=true;
}catch(error){report.failure=String(error.stack||error.message).replace(/https?:\/\/[^\s"']+/g,'[URL hidden]');console.error(report.failure);process.exitCode=1;}
finally{await close().catch(()=>{});console.log('REVIEW_REPORT_BEGIN\n'+JSON.stringify(report,null,2)+'\nREVIEW_REPORT_END');if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,'## Installation review\n```json\n'+JSON.stringify(report,null,2)+'\n```\n');}
