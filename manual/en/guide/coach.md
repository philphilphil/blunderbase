# Your AI assistant

## What is the assistant page?

Blunderbase includes no AI of its own. **Assistant** is where you connect the one you
already use: any client that speaks MCP. Blunderbase serves streamable HTTP at `/mcp` on
the same address your browser is on, so the assistant reads the database the app reads —
your games, not generalities.

## Mint a key

Under **Bearer keys**, give a key a name and mint it. The secret is shown once, so copy it
before pressing **Done**. Mint one per client, and **Revoke** takes a single one back. Your own password
is accepted too, but a password in a config file is a password on disk.

## Connect a client

The page prints ready-made snippets carrying the key you just minted: a one-line command
for Claude Code, two lines for Codex, and JSON for any other client. Copy the one you
need.

## What can the assistant do? { #what-can-the-coach-do }

It searches your games, opens one, finds positions, reads the opening explorer and the
Lichess reference databases, reports statistics, writes and searches notes, keeps
repertoire lines, queues analysis and reports on the queue. It can also put a game or a
position on the [Live](live.md) board so you both look at the same thing.

## What it cannot do

Anything that means handling a secret or reshaping the installation. `runners_status`
tells it which engine hosts are connected and what the backlog is waiting on, but
registering or revoking a runner is yours. It never changes engines, keys or settings.

## The read-only demo

An installation running as the public demo answers every read and refuses every write, so
an assistant pointed at it can look but not import, note or analyse.
