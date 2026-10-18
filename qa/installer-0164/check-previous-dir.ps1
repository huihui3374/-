param([Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$Expected)
$Root=Split-Path -Parent $Installer
$IsolatedTest=$false
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class InstallWindow {
 public IntPtr Handle; public string Text,Class; public bool Enabled; public uint Pid;
}
public static class InstallUI {
 delegate bool EnumProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb,IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h,EnumProc cb,IntPtr p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,string s);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,StringBuilder s);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 static InstallWindow Read(IntPtr h){var t=new StringBuilder(8192);var c=new StringBuilder(128);uint p;GetWindowText(h,t,t.Capacity);GetClassName(h,c,c.Capacity);if(c.ToString().Contains("Edit")){t.Clear();SendMessage(h,0xD,new IntPtr(t.Capacity),t);}GetWindowThreadProcessId(h,out p);return new InstallWindow{Handle=h,Text=t.ToString(),Class=c.ToString(),Enabled=IsWindowEnabled(h),Pid=p};}
 public static InstallWindow[] Windows(){var a=new List<InstallWindow>();EnumWindows((h,p)=>{if(IsWindowVisible(h))a.Add(Read(h));return true;},IntPtr.Zero);return a.ToArray();}
 public static InstallWindow[] Children(IntPtr root){var a=new List<InstallWindow>();EnumChildWindows(root,(h,p)=>{if(IsWindowVisible(h))a.Add(Read(h));return true;},IntPtr.Zero);return a.ToArray();}
 public static void Click(IntPtr h){PostMessage(h,0xF5,IntPtr.Zero,IntPtr.Zero);}
 public static void SetText(IntPtr h,string s){SendMessage(h,0xC,IntPtr.Zero,s);}
}
'@
New-Item -ItemType Directory -Path $Root -Force | Out-Null
$rootFull=[IO.Path]::GetFullPath($Root)
$chosen=Join-Path $rootFull '中文 软件目录'
$cancelPath=Join-Path $rootFull 'cancelled-install'
$report=@{version='0.16.4-retail.1';passed=$false;isolatedTest=[bool]$IsolatedTest;checks=@();screens=@()}
function Assert($condition,[string]$message){if(-not $condition){throw $message}}
function Until([scriptblock]$Check,[int]$Seconds=20){
 $end=[DateTime]::UtcNow.AddSeconds($Seconds)
 do{$value=& $Check;if($value){return $value};Start-Sleep -Milliseconds 150}while([DateTime]::UtcNow -lt $end)
 throw ('Installer UI wait timed out; visible setup windows: '+(@([InstallUI]::Windows()|Where-Object {$_.Class -match 'Wizard|Setup'}|ForEach-Object {@{title=$_.Text;class=$_.Class;pid=$_.Pid;children=@([InstallUI]::Children($_.Handle)|Select-Object Text,Class,Enabled)}})|ConvertTo-Json -Depth 5 -Compress))
}
function Window{ $ids=@($script:setupPid)+@(Get-CimInstance Win32_Process -Filter ("ParentProcessId="+$script:setupPid)|ForEach-Object {$_.ProcessId}); @([InstallUI]::Windows() | Where-Object {$_.Pid -in $ids -and $_.Class -like '*WizardForm*'}) | Select-Object -First 1 }
function Children {param($w);@([InstallUI]::Children($w.Handle))}
function Button {param($w,[string]$pattern);@(Children $w | Where-Object {$_.Enabled -and $_.Class -like '*Button*' -and ($_.Text -replace '[&\s]','') -match $pattern})|Select-Object -First 1}
function Click {param($w,[string]$pattern);$b=Button $w $pattern;Assert ($null -ne $b) ('Button not available: '+$pattern);[InstallUI]::Click($b.Handle);Start-Sleep -Milliseconds 250}
function DirectoryPage {
 $w=Until {Window};Click $w '^下一步';$e=Until {@(Children (Window)|Where-Object {$_.Class -like '*Edit*' -and $_.Text -match '^[A-Za-z]:\\'})|Select-Object -First 1}
 Assert ($null -ne (Button (Window) '^浏览')) 'Browse folder button missing'
 return $e
}
function StartSetup([string]$initial){
 $a='/SP- /NORESTART /CURRENTUSER /DIR="'+$initial+'" /LOG="'+(Join-Path $rootFull ('setup-'+[Guid]::NewGuid().ToString('N')+'.log'))+'"'
 if($IsolatedTest){$a+=' /TESTINSTALL=1'}
 $p=Start-Process -FilePath $Installer -ArgumentList $a -PassThru;[void]$p.Handle;$script:setupPid=$p.Id;return $p
}
function CancelSetup($p){
 $w=Window;Click $w '^取消'
 $confirm=Until {@([InstallUI]::Windows()|Where-Object {$_.Pid -eq $w.Pid -and $_.Handle -ne $w.Handle -and $_.Enabled}|Where-Object {Button $_ '^(是|Yes)'})|Select-Object -First 1}
 Click $confirm '^(是|Yes)'
 Assert ($p.WaitForExit(15000)) 'Cancelled installer did not exit'
}

$p=Start-Process -FilePath $Installer -ArgumentList '/SP- /NORESTART /CURRENTUSER' -PassThru;[void]$p.Handle;$script:setupPid=$p.Id
$edit=DirectoryPage
Assert ([IO.Path]::GetFullPath($edit.Text) -eq [IO.Path]::GetFullPath($Expected)) 'Manual upgrade did not default to the previous selected directory'
CancelSetup $p
Write-Output 'Previous installation path retained; visible directory page verified.'
