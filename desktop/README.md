# Blunderbase Desktop

The desktop application packages the current Blunderbase web UI and Python backend into a
self-contained application. It needs no terminal, Python runtime, container, or external
server, and keeps a complete local Library on the computer.

## Build

On macOS from the repository root:

```bash
make desktop
```

The command builds the web application, freezes the Python backend, and produces a `.app`
and `.dmg` under `desktop/src-tauri/target/release/bundle/`.

The installed application keeps its Library under the operating system's normal
application-data directory. It does not use the repository's `data/` directory.
