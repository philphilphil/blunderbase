# Local-first Installations synchronize through a Sync Home

Blunderbase will remain a complete local-first application: every desktop or Docker
Installation owns a usable local copy of its Library and continues working offline.
Installations synchronize Library Data through one designated Sync Home rather than through
an all-to-all mesh, and the Companion uses a reachable Installation rather than becoming a
second implementation of the Blunderbase core. A Docker Installation can provide the Home
for free; Managed Sync operates the same role as a paid convenience. This preserves local
ownership and self-hosting while giving mobile devices an always-reachable copy and giving
multiple Installations one place to order changes.

## Consequences

- Synchronization exchanges Library changes, never SQLite files or database rows.
- The Sync Home holds a materialized Library and presents the normal Blunderbase interface.
- Desktop and Docker use the same core; their hosting and lifecycle differ.
- Library Data and Device-local Data must be explicitly separated.
- A Companion without a Sync Home can only work while its chosen Installation is reachable.
