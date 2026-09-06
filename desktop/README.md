# Blunderbase Desktop

The desktop application packages the current Blunderbase web UI and Python backend into a
self-contained application. It needs no terminal, Python runtime, container, or external
server, and keeps a complete local Library on the computer.

## Both platforms at once

On macOS from the repository root:

```bash
make desktop
```

This starts the `desktop-windows` workflow in GitHub Actions, builds the macOS bundles
locally while that run is going, then waits for the run and downloads its installer to
`desktop/dist/windows/`. Nothing cross-compiles the Windows installer, so the two halves are
overlapped rather than run one after the other.

The workflow checks out a ref from the remote, so the command refuses to start when HEAD is
ahead of the remote branch — otherwise the `.app` and the `.exe` would come from different
commits. Push first, or set `DESKTOP_WINDOWS_REF` to build a branch or tag of your choosing.
It needs the GitHub CLI (`gh`) signed in.

## macOS alone

```bash
make desktop-macos
```

The command builds the web application, freezes the Python backend, and produces a `.app`
and `.dmg` under `desktop/src-tauri/target/release/bundle/`.

### Signing

A `.dmg` somebody downloads is quarantined, and macOS refuses an unsigned quarantined app
as "damaged" with no way to allow it short of `xattr -d com.apple.quarantine`. A build
meant for other people is therefore signed with a Developer ID certificate and notarized,
which `build-macos.sh` does whenever these variables are set — in the environment, or in
`desktop/.signing.env`, which the script sources and git ignores:

```sh
# The name of the certificate in the keychain, as `security find-identity -v -p codesigning`
# prints it. It has to be a "Developer ID Application" certificate, not "Apple Development":
# only Developer ID passes Gatekeeper outside the App Store. Create one at
# developer.apple.com > Certificates > + > Developer ID Application (Keychain Access >
# Certificate Assistant > Request a Certificate From a Certificate Authority makes the CSR),
# download it and double-click it.
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"

# Notarization: an app-specific password from appleid.apple.com > Sign-In and Security >
# App-Specific Passwords, and the Team ID from developer.apple.com > Membership.
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"
```

An App Store Connect API key works instead of the Apple ID (`APPLE_API_KEY`,
`APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`); these are tauri's variables, documented in its
[macOS signing guide](https://v2.tauri.app/distribute/sign/macos/). Notarization uploads the
bundle to Apple and waits, usually a minute or two, before stapling the ticket.

Two things get signed. PyInstaller signs every library it collects and the backend
executable, with the hardened runtime and `desktop/backend-entitlements.plist` — tauri
signs the shell, notarizes and staples the bundle and signs the `.dmg`, but leaves the
files it copies into `Contents/Resources` alone, and notarization rejects a bundle with a
single unsigned Mach-O inside. Without `APPLE_SIGNING_IDENTITY` the build is ad-hoc signed,
which runs on the machine that built it and nowhere else.

To check a finished build before shipping it:

```bash
codesign --verify --deep --strict --verbose=2 desktop/src-tauri/target/release/bundle/macos/Blunderbase.app
spctl --assess --type execute --verbose desktop/src-tauri/target/release/bundle/macos/Blunderbase.app
```

The second prints `accepted` with `source=Notarized Developer ID` when everything went
through.

The installed application keeps its Library under the operating system's normal
application-data directory. It does not use the repository's `data/` directory.

## Windows alone

```bash
make desktop-windows
```

Dispatches the `desktop-windows` workflow and waits for it, without building anything
locally; the workflow can also be run by hand from the Actions tab. Its artifact is a
self-contained NSIS `-setup.exe` installer built on Windows. The preview is unsigned, so
Windows may show a SmartScreen warning; public installers should be code-signed first.

For a local build on a Windows development machine with Python 3.12, uv, pnpm, Node, and
Rust installed:

```powershell
pnpm --dir web install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
pnpm --dir desktop build:windows
```

The installer is written below `desktop/src-tauri/target/release/bundle/nsis/`.
