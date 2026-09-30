# Your AI assistant

## What is the assistant page?

Blunderbase includes no AI of its own. **Assistant** is where you connect the one you
already use: any client that speaks MCP. Blunderbase serves streamable HTTP at `/mcp` on
the same address your browser is on, so the assistant reads the database the app reads —
your games, not generalities.

## Mint a key

Under **Bearer keys**, give a key a name and press **Create**. The secret is shown once, so
copy it with **Copy key** before pressing **Done**. Mint one per client. **Revoke…** on a
key asks first, and **Revoke** in its place takes that one key back.
Your browser password is not accepted for MCP.

## Connect a client

The page prints ready-made snippets carrying the key you just minted: a one-line command
for Claude Code, two lines for Codex, and JSON for any other client. The **Copy** button
beside each (**Copy command**, **Copy commands**, **Copy config**) copies exactly that
block.

## What can the assistant do? { #what-can-the-coach-do }

It searches your games, opens one, finds positions, reads the opening explorer and the
Lichess reference databases, reports statistics, writes and searches notes, keeps
repertoire lines, queues analysis and reports on the queue. It can also put a game or a
position on the [Live](live.md) board so you both look at the same thing.

It knows your [collections](collections.md). `list_collections` names them with their
counts and rules, and `add_to_collection` and `remove_from_collection` put games in and take
them out, by the collection's name or its number. `search_games`, `get_last_games`,
`get_stats` and `opening_explorer` each take a `collection` too, so "how is my league season
going?" is answered from that collection's games alone. Like the list a collection's card
opens,
`search_games` lists every game in it, a reference game you put in by hand too; the others
keep to your own games in it, as Stats does. `search_games`, `get_last_games` and
`get_stats` also take `rated`, for rated or casual games only. Making, renaming or deleting a collection is yours, in the app.

## What it cannot do

Anything that means handling a secret or reshaping the installation. `runners_status`
tells it which engine hosts are connected and what the backlog is waiting on, but
registering or revoking a runner is yours. It never changes engines, keys or settings.

## The read-only demo

An installation running as the public demo answers every read and refuses every write, so
an assistant pointed at it can look but not import, note or analyse.
