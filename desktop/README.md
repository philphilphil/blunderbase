# Blunderbase Desktop

The desktop application packages the current Blunderbase web UI and Python backend into a
self-contained application. It needs no terminal, Python runtime, container, or external
server, and keeps a complete local Library on the computer.

## macOS build

On macOS from the repository root:

```bash
make desktop
```

The command builds the web application, freezes the Python backend, and produces a `.app`
and `.dmg` under `desktop/src-tauri/target/release/bundle/`.

The installed application keeps its Library under the operating system's normal
application-data directory. It does not use the repository's `data/` directory.

## Windows preview build

Run the `desktop-windows` workflow manually in GitHub Actions. Its artifact is a
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
