# Signing the Windows installer

The installer is unsigned by default, so Windows (Smart App Control, SmartScreen) may block or warn.
Signing is optional and switched on by two GitHub secrets; without them the build is unchanged.

## Self-signed (your own machines)

Run `scripts/setup-signing.ps1` in PowerShell on Windows. It creates a code-signing certificate,
exports `signing.pfx` (private, password protected) and `signing.cer` (public), trusts the
certificate on that machine (Trusted Root and Trusted Publishers; it asks for administrator for that
step only), and stores the secrets `WINDOWS_CERTIFICATE` (base64 of the pfx) and
`WINDOWS_CERTIFICATE_PASSWORD` in the repository with the GitHub CLI (or copies the value to the
clipboard if `gh` is not available). `-Uninstall -Thumbprint <thumbprint>` removes the trust again.

On every other machine that runs the installer, trust the public half as administrator:

```powershell
certutil -addstore -f Root "signing.cer"
certutil -addstore -f TrustedPublisher "signing.cer"
```

A self-signed certificate is trusted only where you do this. Whether Smart App Control accepts a
locally trusted self-signed certificate is not guaranteed: try it. Keep `signing.pfx` private (anyone
with it and the password can sign software your machines trust) and use it for nothing else.

## How the build signs

`.github/workflows/ci.yml` (job `windows`): when `WINDOWS_CERTIFICATE` is set it imports the
certificate into the runner's personal store, writes a Tauri config override with the thumbprint,
SHA-256 and a timestamp server (so the signature stays valid after the certificate expires), builds
with `tauri build --config`, then checks the installer is signed by that thumbprint. Without the
secrets it builds unsigned as before.

## For other people (public release)

Use a certificate Windows trusts by default. The realistic option from GitHub Actions is Azure Trusted
Signing (a Tauri `signCommand` or the Azure action); new OV/EV certificates need a hardware or cloud
key, which a hosted runner cannot hold as a file.
