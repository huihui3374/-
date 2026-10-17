if ($env:GITHUB_REPOSITORY_VISIBILITY -ne 'public') { throw 'Free-only QA: public repository required' }
$ErrorActionPreference = 'Stop'
$qaRoot = Join-Path $env:RUNNER_TEMP 'chengjing-cross-pc'
New-Item -ItemType Directory -Path $qaRoot -Force | Out-Null
$release = (Invoke-RestMethod 'https://chengjingshop.top/api/applications' -Headers @{'User-Agent'='Chengjing-QA/1.0'}).applications | Where-Object { $_.id -eq 'chengjing-connect' }
if ($release.version -ne '0.14.0-retail.2' -or $release.package.sha256 -ne '96db1dbbb6361e71e29d326d91094812611bbd206ef42b21dd13d45f2407b5f0') { throw 'Published package changed; refresh the reviewed test input first' }
$zip = Join-Path $qaRoot 'published.zip'
Invoke-WebRequest $release.downloadUrl -OutFile $zip -Headers @{'User-Agent'='Chengjing-QA/1.0'} -TimeoutSec 360
if ((Get-Item $zip).Length -ne $release.package.bytes -or (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $release.package.sha256) { throw 'Published archive checksum mismatch' }
$extract = Join-Path $qaRoot '中文路径 with spaces'
Expand-Archive -LiteralPath $zip -DestinationPath $extract
$exe = Get-ChildItem $extract -Recurse -Filter 'Chengjing-Retail.exe' | Select-Object -First 1
if (-not $exe) { throw 'Packaged executable missing' }
$certificate = New-SelfSignedCertificate -DnsName 'localhost' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(2)
$cer = Join-Path $qaRoot 'qa-localhost.cer'
Export-Certificate -Cert $certificate -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
$password = ConvertTo-SecureString 'QA-only-ephemeral-certificate' -AsPlainText -Force
Export-PfxCertificate -Cert $certificate -FilePath (Join-Path $qaRoot 'qa-localhost.pfx') -Password $password | Out-Null
$pem = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($certificate.RawData,[Base64FormattingOptions]::InsertLineBreaks) + "`n-----END CERTIFICATE-----`n"
$pem | Set-Content -Encoding ascii (Join-Path $qaRoot 'qa-localhost.pem')
"QA_ROOT=$qaRoot" | Out-File $env:GITHUB_ENV -Encoding utf8 -Append
"QA_EXE=$($exe.FullName)" | Out-File $env:GITHUB_ENV -Encoding utf8 -Append
"NODE_EXTRA_CA_CERTS=$(Join-Path $qaRoot 'qa-localhost.pem')" | Out-File $env:GITHUB_ENV -Encoding utf8 -Append
