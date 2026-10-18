param()
$ErrorActionPreference='Stop'
# This intentionally changes routes, solely on an ephemeral CI virtual machine.
# Refuse execution on a developer's or customer's normal Windows computer.
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or !$env:RUNNER_TEMP -or $env:GITHUB_REPOSITORY_VISIBILITY -ne 'public'){throw 'Ephemeral public GitHub Windows runner required'}
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Elevated isolated runner required'}
$root=Join-Path $env:RUNNER_TEMP ('proxy-tun-qa-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root|Out-Null
$core=$null
$alias='CJProxy-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
$expectedBinary='04f8d7fc2b314771e1ecbf15951d59f0e1cb7914503c88cfb6972ff6a824e314'
$expectedArchive='974a4d7ad69aed27aa2e8f91d61113573c14dadb14562c63e58effabf59816f0'
$checks=[ordered]@{scope='ephemeral-windows-tun-driver';coreIntegrity=$false;startsDisabled=$false;actualTun=$false;ipv4Routes=$false;ipv6Routes=$false;gracefulRecovery=$false;crashRecovery=$false;originalProxyAndDnsPreserved=$false;publicExitValidated=$false;applicationUiValidated=$false}
function Assert($condition,[string]$message){if(!$condition){throw $message}}
function Network-Fingerprint {
 $settings=Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
 $proxy=[ordered]@{};foreach($n in @('ProxyEnable','ProxyServer','ProxyOverride','AutoConfigURL')){if($settings.PSObject.Properties.Name -contains $n){$proxy[$n]=$settings.$n}}
 $dns=@(Get-DnsClientServerAddress | Where-Object {$_.InterfaceAlias -ne $alias} | ForEach-Object {($_.InterfaceIndex.ToString()+'|'+$_.AddressFamily.ToString()+'|'+($_.ServerAddresses -join ','))} | Sort-Object)
 $defaults=@(Get-NetRoute -ErrorAction Stop | Where-Object {$_.DestinationPrefix -in @('0.0.0.0/0','::/0')} | ForEach-Object {($_.InterfaceIndex.ToString()+'|'+$_.DestinationPrefix+'|'+$_.NextHop+'|'+$_.RouteMetric.ToString())} | Sort-Object)
 return [ordered]@{proxy=$proxy;dns=$dns;defaults=$defaults}|ConvertTo-Json -Depth 6 -Compress
}
function Free-Port {
 $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
 $listener.Start();try{return $listener.LocalEndpoint.Port}finally{$listener.Stop()}
}
$controller=Free-Port
$mixed=Free-Port
while($mixed -eq $controller){$mixed=Free-Port}
$secret=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).TrimEnd('=').Replace('+','-').Replace('/','_')
function Core-Api([string]$method,[string]$path,$body=$null){
 $args=@{Uri=('http://127.0.0.1:'+$controller+$path);Method=$method;Headers=@{Authorization=('Bearer '+$secret)};TimeoutSec=5;NoProxy=$true}
 if($null -ne $body){$args.ContentType='application/json';$args.Body=$body|ConvertTo-Json -Depth 10 -Compress}
 return Invoke-RestMethod @args
}
function Start-Core {
 $info=[Diagnostics.ProcessStartInfo]::new($binary)
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.ArgumentList.Add('-d');$info.ArgumentList.Add($root);$info.ArgumentList.Add('-f');$info.ArgumentList.Add((Join-Path $root 'config.json'))
 $info.Environment['SKIP_SYSTEM_IPV6_CHECK']='1'
 $script:core=[Diagnostics.Process]::Start($info)
 for($i=0;$i -lt 40;$i++){
  if($core.HasExited){throw 'Core exited before controller readiness'}
  try{$version=Core-Api 'GET' '/version';if($version.version){return}}catch{}
  Start-Sleep -Milliseconds 150
 }
 throw 'Core controller readiness timeout'
}
function Enable-Tun {
 Core-Api 'PATCH' '/configs' @{tun=@{enable=$true}}|Out-Null
 $running=Core-Api 'GET' '/configs'
 Assert ($running.tun.enable -eq $true -and $running.tun.device -ceq $alias) 'Controller did not report the requested TUN'
 Assert ($running.tun.'auto-route' -and $running.tun.'strict-route' -and $running.ipv6) 'Protection settings changed'
 $adapter=Get-NetAdapter -IncludeHidden | Where-Object {$_.Name -ceq $alias -and $_.Status -eq 'Up'}
 Assert ($null -ne $adapter) 'Actual active TUN adapter missing'
 $routes4=@(Get-NetRoute -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4)
 $routes6=@(Get-NetRoute -InterfaceIndex $adapter.ifIndex -AddressFamily IPv6)
 Assert (@($routes4|Where-Object {[int]($_.DestinationPrefix.Split('/')[1]) -le 1}).Count -gt 0) 'No actual IPv4 TUN default/split-default route'
 Assert (@($routes6|Where-Object {[int]($_.DestinationPrefix.Split('/')[1]) -le 1}).Count -gt 0) 'No actual IPv6 TUN default/split-default route'
 $checks.actualTun=$true;$checks.ipv4Routes=$true;$checks.ipv6Routes=$true
}
function Assert-Recovered([string]$baseline) {
 for($i=0;$i -lt 50;$i++){
  $up=@(Get-NetAdapter -IncludeHidden | Where-Object {$_.Name -ceq $alias -and $_.Status -eq 'Up'})
  if(!$up.Count -and (Network-Fingerprint) -ceq $baseline){return}
  Start-Sleep -Milliseconds 200
 }
 throw 'Network baseline not restored after TUN shutdown'
}
try{
 $archive=Join-Path $root 'core.zip'
 Invoke-WebRequest -Uri 'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.32/mihomo-windows-amd64-compatible-v1.19.32.zip' -OutFile $archive
 Assert ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $expectedArchive) 'Official archive checksum mismatch'
 Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $root 'core')
 $binary=(Get-ChildItem -LiteralPath (Join-Path $root 'core') -Filter '*.exe' -Recurse | Select-Object -First 1).FullName
 Assert ($binary -and (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $expectedBinary) 'Pinned binary checksum mismatch'
 $checks.coreIntegrity=$true
 $config=@{
  'mixed-port'=$mixed;'bind-address'='127.0.0.1';'allow-lan'=$false;mode='rule';'log-level'='warning';'external-controller'=('127.0.0.1:'+$controller);secret=$secret;ipv6=$true
  dns=@{enable=$true;ipv6=$true;'enhanced-mode'='fake-ip';'fake-ip-range'='198.18.0.1/16';'fake-ip-range6'='fdfe:dcba:9876::1/64';'fake-ip-filter'=@('localhost','*.localhost','*.local','*.lan');'use-hosts'=$false;'use-system-hosts'=$false;'proxy-server-nameserver'=@('system');nameserver=@('https://dns.google/dns-query');'respect-rules'=$true}
  tun=@{enable=$false;device=$alias;stack='mixed';'auto-route'=$true;'auto-detect-interface'=$true;'strict-route'=$true;'dns-hijack'=@('any:53','tcp://any:53');'inet6-address'=@('fdfe:dcba:9876::1/126');mtu=1500}
  # This driver-only fixture cannot provide an Internet relay or access private networks.
  rules=@('NETWORK,UDP,REJECT','MATCH,REJECT')
 }
 [IO.File]::WriteAllText((Join-Path $root 'config.json'),($config|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
 $baseline=Network-Fingerprint
 Start-Core
 $state=Core-Api 'GET' '/configs';Assert (!$state.tun.enable) 'TUN must start disabled';$checks.startsDisabled=$true
 Enable-Tun
 Core-Api 'PATCH' '/configs' @{tun=@{enable=$false}}|Out-Null
 Assert-Recovered $baseline;$checks.gracefulRecovery=$true
 Enable-Tun
 Stop-Process -Id $core.Id -Force
 $core.WaitForExit(5000)|Out-Null;$core=$null
 Assert-Recovered $baseline;$checks.crashRecovery=$true;$checks.originalProxyAndDnsPreserved=$true
 $checks|ConvertTo-Json -Compress
}finally{
 if($core -and !$core.HasExited){try{Core-Api 'PATCH' '/configs' @{tun=@{enable=$false}}|Out-Null}catch{};Stop-Process -Id $core.Id -Force -ErrorAction SilentlyContinue}
 Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
