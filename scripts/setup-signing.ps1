<#
.SYNOPSIS
  Creates a self-signed code-signing certificate for DocumentEditor, trusts it on this machine,
  and stores it as GitHub secrets so the Windows build on GitHub Actions can sign the installer.

.DESCRIPTION
  What it does, in order:
    1. Creates a code-signing certificate in your personal store.
    2. Exports signing.pfx (private key, password protected) and signing.cer (public half).
    3. Trusts the certificate on THIS machine (Trusted Root + Trusted Publishers). Needs administrator;
       the script asks for it just for that step.
    4. Stores the secrets WINDOWS_CERTIFICATE and WINDOWS_CERTIFICATE_PASSWORD in the GitHub repo,
       using the GitHub CLI (gh) if it is installed and signed in; otherwise it copies the value to
       the clipboard and tells you where to paste it.

  A self-signed certificate is trusted only on machines where you do step 3. Anyone else will still
  see an unknown publisher. Keep signing.pfx private: anyone with it (and the password) can sign
  software that your machines will trust. Use this certificate for nothing else.

.PARAMETER Repo
  The GitHub repository as owner/name. Detected from the git remote when run inside the repo.

.PARAMETER OutDir
  Where signing.pfx and signing.cer are written. Default: a folder in your profile.

.PARAMETER Years
  How long the certificate is valid. Default 5.

.PARAMETER SkipTrust
  Do not trust the certificate on this machine.

.PARAMETER SkipGitHub
  Do not store GitHub secrets (the base64 value is copied to the clipboard instead).

.PARAMETER Uninstall
  Removes a certificate from this machine's trust stores (use with -Thumbprint). Does not touch GitHub.

.PARAMETER Thumbprint
  The certificate to remove with -Uninstall.

.EXAMPLE
  .\scripts\setup-signing.ps1
  .\scripts\setup-signing.ps1 -Repo Iain-Stark-GlosCity/DocumentEditor
  .\scripts\setup-signing.ps1 -Uninstall -Thumbprint ABCDEF0123...
#>
[CmdletBinding()]
param(
  [string]$Repo = "",
  [string]$OutDir = (Join-Path $env:USERPROFILE "DocumentEditor-signing"),
  [int]$Years = 5,
  [switch]$SkipTrust,
  [switch]$SkipGitHub,
  [switch]$Uninstall,
  [string]$Thumbprint = ""
)

$ErrorActionPreference = "Stop"

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Runs a script block in an elevated PowerShell and waits. Used only for the trust step.
function Invoke-Elevated([string]$Command) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
  $p = Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded)
  if ($p.ExitCode -ne 0) { throw "The elevated step failed (exit code $($p.ExitCode))." }
}

function ConvertTo-PlainText([Security.SecureString]$Secure) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# --- Uninstall -------------------------------------------------------------------------------
if ($Uninstall) {
  if ($Thumbprint -eq "") { throw "Give the certificate with -Thumbprint." }
  $t = $Thumbprint.Replace(" ", "").ToUpper()
  $cmd = @"
`$ErrorActionPreference = 'SilentlyContinue'
foreach (`$store in 'Cert:\LocalMachine\Root', 'Cert:\LocalMachine\TrustedPublisher', 'Cert:\CurrentUser\My') {
  Get-ChildItem `$store | Where-Object { `$_.Thumbprint -eq '$t' } | Remove-Item
}
"@
  if (Test-Admin) { Invoke-Expression $cmd } else { Invoke-Elevated $cmd }
  Write-Host "Removed $t from this machine's stores. GitHub secrets are not changed." -ForegroundColor Green
  return
}

# --- Find the repository ----------------------------------------------------------------------
if ($Repo -eq "" -and -not $SkipGitHub) {
  try {
    $remote = (& git config --get remote.origin.url) 2>$null
    if ($remote -match "github\.com[:/](.+?)(\.git)?$") { $Repo = $Matches[1] }
  } catch { }
}

# --- 1. Create the certificate ----------------------------------------------------------------
if (Test-Path (Join-Path $OutDir "signing.pfx")) {
  throw "$OutDir\signing.pfx already exists. Move or delete it first, so nothing is overwritten."
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "Creating the certificate..." -ForegroundColor Cyan
$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=DocumentEditor (self-signed)" `
  -KeyUsage DigitalSignature -KeyExportPolicy Exportable `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears($Years)
Write-Host "  Thumbprint: $($cert.Thumbprint)"
Write-Host "  Valid until: $($cert.NotAfter.ToString('yyyy-MM-dd'))"

# --- 2. Export it -----------------------------------------------------------------------------
Write-Host ""
Write-Host "Choose a password for signing.pfx (it protects the private key)." -ForegroundColor Cyan
$pw1 = Read-Host "Password" -AsSecureString
$pw2 = Read-Host "Repeat it" -AsSecureString
if ((ConvertTo-PlainText $pw1) -ne (ConvertTo-PlainText $pw2)) { throw "The passwords did not match." }
if ((ConvertTo-PlainText $pw1).Length -lt 12) { throw "Use at least 12 characters." }

$pfx = Join-Path $OutDir "signing.pfx"
$cer = Join-Path $OutDir "signing.cer"
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pw1 | Out-Null
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Write-Host "  Wrote $pfx (private: keep it safe)"
Write-Host "  Wrote $cer (public: safe to share)"

# --- 3. Trust it on this machine --------------------------------------------------------------
if ($SkipTrust) {
  Write-Host ""
  Write-Host "Skipped trusting the certificate. On each machine that runs the installer, as administrator:" -ForegroundColor Yellow
  Write-Host "  certutil -addstore -f Root `"$cer`""
  Write-Host "  certutil -addstore -f TrustedPublisher `"$cer`""
} else {
  Write-Host ""
  Write-Host "Trusting the certificate on this machine (needs administrator)..." -ForegroundColor Cyan
  $trust = @"
`$ErrorActionPreference = 'Stop'
Import-Certificate -FilePath '$cer' -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
Import-Certificate -FilePath '$cer' -CertStoreLocation 'Cert:\LocalMachine\TrustedPublisher' | Out-Null
"@
  if (Test-Admin) { Invoke-Expression $trust } else { Invoke-Elevated $trust }
  Write-Host "  Trusted in Root and Trusted Publishers."
}

# --- 4. GitHub secrets ------------------------------------------------------------------------
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($pfx))
$stored = $false
if (-not $SkipGitHub) {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if ($gh -and $Repo -ne "") {
    & gh auth status *> $null
    if ($LASTEXITCODE -eq 0) {
      Write-Host ""
      Write-Host "Storing the secrets in $Repo ..." -ForegroundColor Cyan
      $b64 | & gh secret set WINDOWS_CERTIFICATE --repo $Repo
      if ($LASTEXITCODE -ne 0) { throw "Could not set WINDOWS_CERTIFICATE." }
      (ConvertTo-PlainText $pw1) | & gh secret set WINDOWS_CERTIFICATE_PASSWORD --repo $Repo
      if ($LASTEXITCODE -ne 0) { throw "Could not set WINDOWS_CERTIFICATE_PASSWORD." }
      $stored = $true
      Write-Host "  Stored WINDOWS_CERTIFICATE and WINDOWS_CERTIFICATE_PASSWORD."
    } else {
      Write-Host "The GitHub CLI is installed but not signed in (run: gh auth login)." -ForegroundColor Yellow
    }
  } elseif (-not $gh) {
    Write-Host "The GitHub CLI (gh) is not installed, so the secrets cannot be stored automatically." -ForegroundColor Yellow
  }
}
if (-not $stored) {
  Set-Clipboard -Value $b64
  Write-Host ""
  Write-Host "Add two secrets by hand at:" -ForegroundColor Yellow
  if ($Repo -ne "") { Write-Host "  https://github.com/$Repo/settings/secrets/actions" } else { Write-Host "  your repository > Settings > Secrets and variables > Actions" }
  Write-Host "  WINDOWS_CERTIFICATE          = the base64 text now on your clipboard"
  Write-Host "  WINDOWS_CERTIFICATE_PASSWORD = the password you just chose"
}

# --- Done -------------------------------------------------------------------------------------
$pw1 = $null; $pw2 = $null; $b64 = $null
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Certificate thumbprint: $($cert.Thumbprint)"
Write-Host "  Next: push to GitHub; the Windows build signs the installer when the secrets exist."
Write-Host "  Check a signed installer with:  Get-AuthenticodeSignature .\DocumentEditor_*_x64-setup.exe | Format-List"
Write-Host "  Keep $pfx somewhere safe (or delete it once the secrets are stored). To remove this certificate later:"
Write-Host "    .\scripts\setup-signing.ps1 -Uninstall -Thumbprint $($cert.Thumbprint)"
