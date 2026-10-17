param([ValidateSet('download', 'extract', 'certificate')][string]$Stage)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:GITHUB_REPOSITORY_VISIBILITY -ne 'public') { throw 'Free-only QA: public repository required' }
$qaRoot = Join-Path $env:RUNNER_TEMP 'chengjing-cross-pc'
New-Item -ItemType Directory -Path $qaRoot -Force | Out-Null
$zip = Join-Path $qaRoot 'published-setup.exe'
"QA_ROOT=$qaRoot" | Out-File $env:GITHUB_ENV -Encoding utf8 -Append
if ($Stage -eq 'download') {
    Write-Host 'Fetching live published application metadata (30 second timeout)'
    $release = (Invoke-RestMethod 'https://chengjingshop.top/api/applications' -Headers @{'User-Agent'='Chengjing-QA/1.0'} -TimeoutSec 30).applications | Where-Object { $_.id -eq 'chengjing-connect' }
    Write-Host ('Observed public release: ' + ($release | ConvertTo-Json -Depth 6 -Compress))
    if ($release.version -ne '0.14.0-retail.2' -or $release.package.sha256 -ne '78d931935a54855f28d0f6b5507783ecd5b4bdd3ada740e65b6fc8e89a9fe9f2' -or $release.package.bytes -ne 116968751) { throw 'Published package changed; refresh the reviewed test input first' }
    Write-Host 'Metadata matched; fetching advertised HTTP ranges with bounded concurrency'
    $downloadUrl = [Uri]::new([Uri]'https://chengjingshop.top', [string]$release.downloadUrl).AbsoluteUri
    & node qa/cross-pc/range-download.mjs $downloadUrl $zip
    if ($LASTEXITCODE -ne 0) { throw 'Verified range download failed' }
    if ((Get-Item $zip).Length -ne 116968751) { throw 'Published archive size mismatch' }
    Write-Host 'Download completed'
} elseif ($Stage -eq 'extract') {
    Write-Host 'Checking SHA-256 of downloaded archive'
    if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne '78d931935a54855f28d0f6b5507783ecd5b4bdd3ada740e65b6fc8e89a9fe9f2') { throw 'Published archive checksum mismatch' }
    $extract = Join-Path $qaRoot '中文路径 with spaces'
    Write-Host ('Installer description: ' + (Get-Item $zip).VersionInfo.FileDescription)
    $binaryText = [System.Text.Encoding]::Latin1.GetString([System.IO.File]::ReadAllBytes($zip))
    if ($binaryText.Contains('Inno Setup')) {
        $engine = 'Inno Setup'
        $arguments = "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /CURRENTUSER /DIR=`"$extract`" /LOG=`"$(Join-Path $qaRoot 'installer.log')`""
    } elseif ($binaryText.Contains('Nullsoft') -or $binaryText.Contains('NSIS')) {
        $engine = 'NSIS'
        $arguments = "/S /D=$extract"
    } else { throw 'Unknown installer engine; no unreviewed interactive installation attempted' }
    $binaryText = $null
    Write-Host "Detected $engine; installing in isolated Chinese/spaces path on test VM"
    $process = Start-Process -FilePath $zip -ArgumentList $arguments -PassThru
    if (-not $process.WaitForExit(90000)) {
        $process.Kill()
        throw 'Silent installer exceeded 90 seconds'
    }
    if ($process.ExitCode -notin @(0, 3010)) {
        if (Test-Path (Join-Path $qaRoot 'installer.log')) { Get-Content (Join-Path $qaRoot 'installer.log') -Tail 20 }
        throw "Silent installer failed: $($process.ExitCode)"
    }
    @{ engine=$engine; exitCode=$process.ExitCode; installedInChinesePath=$true } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $qaRoot 'installation-evidence.json')
    $exe = Get-ChildItem $extract -Recurse -Filter 'Chengjing-Retail.exe' | Select-Object -First 1
    if (-not $exe) { throw 'Packaged executable missing' }
    "QA_EXE=$($exe.FullName)" | Out-File $env:GITHUB_ENV -Encoding utf8 -Append
    Write-Host 'Actual public installer completed; installed executable located'
} elseif ($Stage -eq 'certificate') {
    Write-Host 'Generating disposable localhost TLS fixture with in-memory .NET cryptography'
    $rsa = [System.Security.Cryptography.RSA]::Create(2048)
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddDnsName('localhost')
    $request.CertificateExtensions.Add($san.Build())
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(2))
    [System.IO.File]::WriteAllBytes((Join-Path $qaRoot 'qa-localhost.pfx'), $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, 'QA-only-ephemeral-certificate'))
    $certificate.ExportCertificatePem() | Set-Content -Encoding ascii (Join-Path $qaRoot 'qa-localhost.pem')
    Write-Host 'Fixture PFX/PEM generated; trusting public test certificate on ephemeral runner only'
    # CurrentUser Root import can open an interactive Windows security dialog.
    # The disposable hosted runner is administrator-owned; machine-store insertion
    # avoids that UI and fails explicitly if the runner does not grant access.
    $store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root', 'LocalMachine')
    try {
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $publicCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
        $store.Add($publicCertificate)
    } finally { $store.Close(); $rsa.Dispose() }
    Write-Host 'Disposable public test certificate trusted successfully'
    "NODE_EXTRA_CA_CERTS=$(Join-Path $qaRoot 'qa-localhost.pem')" | Out-File $env:GITHUB_ENV -Encoding utf8 -Append
} else { throw 'Specify preparation stage' }
