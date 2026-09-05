# Install

Blunderbase is one process on one port. Everything — the page, the API, the event socket
and the MCP endpoint — is served from the same origin, so an installation is a
single container or a single application.

Pick one of three:

| You want | Use |
|---|---|
| A server you and your other devices reach over the network | [Docker](#docker) |
| One computer, no terminal, no container | [The desktop application](#the-desktop-application) |
| The same thing on a machine you develop on | [Docker](#docker), or run it from a source checkout |

## Docker

The image is `ghcr.io/philphilphil/blunderbase:latest`. It ships Stockfish, so a fresh
installation can analyse without anything else being installed.

```bash
# A sample compose file: one service, one volume.
curl -O https://blunderbase.org/docker-compose.yml
docker compose up -d
```

Without compose:

```bash
docker run -d --name blunderbase -p 8765:8765 \
  -v blunderbase-data:/data \
  ghcr.io/philphilphil/blunderbase:latest
```

| Thing | Value |
|---|---|
| Port | `8765` inside the container |
| Volume | `/data` — the database, uploaded PGN files and any engine downloaded from the app |
| Database | `/data/blunderbase.db` |
| Start-up | The container migrates the database, then serves on `0.0.0.0:8765` |

On a machine other people can reach, bind the published port to loopback
(`"127.0.0.1:8765:8765"`) and put TLS in front of it. See [Deploy](deploy.md).

The compose file above is a sample. Every setting it can carry is in
[Configuration](configuration.md).

## The desktop application

macOS and Windows installers are on the
[latest release page](https://github.com/philphilphil/blunderbase/releases/latest). Each
file carries its version in the name: `Blunderbase-<version>-macOS-arm64.dmg` and
`Blunderbase-<version>-Windows-x64-setup.exe`.

The application bundles the web app and the backend. It needs no Python, no container and
no terminal, and it runs entirely on that computer.

| Platform | Notes |
|---|---|
| macOS | Apple silicon. The build is unsigned, so allow it in System Settings the first time |
| Windows | x64, an NSIS installer. Unsigned, so Windows shows a SmartScreen notice |

Where the library lives:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/app.blunderbase.desktop/blunderbase.db` |
| Windows | `%APPDATA%\app.blunderbase.desktop\blunderbase.db` |

`desktop.log` sits beside the database and is the first place to look if the window opens
empty.

The desktop application ships no engine binary. Point it at a Stockfish already on the
machine, use the browser's WebAssembly build, or attach a
[remote runner](runners.md). See [Engines](engines.md).

It also has no MCP endpoint, so connecting [your AI assistant](../guide/coach.md) needs a
server or Docker installation.

## First run

Open the address the installation is on — `http://localhost:8765` for a default Docker
installation; the desktop application opens its own window.

**The first person to open a fresh installation chooses the password.** Until one is
chosen the app shows the setup screen instead of the login one, and every API call answers
`401 setup_required`. There is no registration and no second account: one owner, one
password.

The password must be at least eight characters. It is also the bearer token `/mcp` accepts
until you mint keys, so choose it accordingly.

Then work through [Getting started](../guide/getting-started.md): connect an account,
import, register an engine.

A fresh installation runs a short guided tour the first time it is opened. **Show the tour
again** in the account menu brings it back.

To set or reset the password without a browser:

```bash
blunderbase set-password
```

It asks twice and never echoes. In Docker, prefix it with
`docker exec -it blunderbase`.

## Signing in and sessions

Signing in sets an HTTP-only `blunderbase_session` cookie that slides over 30 days: every
request you make pushes the expiry out again. The cookie carries `Secure` on any host that
is not loopback, so an installation reached by name over plain HTTP will not keep you
signed in — put TLS in front of it.

Five wrong passwords in a row lock the door for a few seconds, and each further failure
doubles that up to five minutes.

Only hashes are stored, of the password and of the session tokens alike, so a copy of the
database is not a way in.

The desktop application authenticates its own window with a per-launch token and never asks
for a password.

## Changing the password

Account menu → **Change password**. It asks for the current one and the new one twice.

A password change signs every other browser out and invalidates the password as an MCP
bearer token. Minted keys keep working.

## How an MCP client authenticates

`/mcp` accepts, in this order:

1. `BLUNDERBASE_MCP_BEARER_KEY`, when the installation sets it — an extra accepted token,
   for automation and compose files.
2. A key you minted on the **Assistant** page.
3. The owner's password.

So a password chosen in the browser works at `/mcp` immediately, with no restart.

Once more than one client wants in, mint a key per client on **Assistant**. Keys look like
`bb_mcp_…`, are stored as a SHA-256 hash, are shown exactly once, and are revoked
individually — deleting one signs out that client and nothing else. The list shows when
each key was last used.

Guessing the password at `/mcp` is rate limited on its own budget of ten attempts a
minute, so it never costs your browser login its lockout, and a minted key is never slowed
down by somebody else's guesses.

Connecting a client is [Your AI assistant](../guide/coach.md).

## Upgrading

Docker:

```bash
docker compose pull
docker compose up -d
```

The container applies pending migrations on start-up, and a schema failure is the
container's exit code rather than a stack trace inside a running process. Take a
[backup](backup.md) first if the release notes mention one.

Desktop: download the newer installer from the release page and install over the old one.
The library stays where it is.

Releases and their notes are at
[github.com/philphilphil/blunderbase/releases](https://github.com/philphilphil/blunderbase/releases).
