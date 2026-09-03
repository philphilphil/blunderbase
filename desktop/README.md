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
