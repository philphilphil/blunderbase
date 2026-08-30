# Target Distribution Architecture

This document defines the target architecture for Desktop, Docker, mobile companionship,
and synchronization. It describes ownership and operating modes, not an implementation
plan. Canonical terms are defined in [the domain glossary](../CONTEXT.md), and the topology
decision is recorded in
[ADR 0001](adr/0001-local-first-installations-sync-through-a-home.md). The current code
architecture remains documented in [ARCHITECTURE.md](ARCHITECTURE.md).

## Invariants

- The desktop application is the primary consumer product and requires no external server,
  container runtime, development tool, or account.
- Every desktop or Docker Installation contains the same Blunderbase core and a complete
  local Library copy.
- An Installation remains useful offline; synchronization is optional.
- Synchronization transfers domain-level Library changes, not SQLite files or normalized
  database rows.
- The synchronization capability is free and self-hostable. Managed Sync charges for
  operating an always-reachable Sync Home.
- A Companion uses one reachable Installation. It does not contain a second implementation
  of Blunderbase's chess and query rules.

## Topology

```text
                         Companion
                             |
                             v
Desktop Installation <-> Sync Home <-> Docker/Desktop Installation
   complete Library       complete Library       complete Library
   works offline          always reachable       works offline
```

The Sync Home is the single exchange point for a synchronized Library. Installations do not
form an all-to-all mesh. This gives every participant one ordered history while allowing
each desktop or Docker Installation to keep working from its local copy.

Without a Sync Home, a Companion may connect directly to a reachable desktop or Docker
Installation. That is remote use, not synchronization, and stops working when the chosen
Installation is unavailable.

## Operating modes

| Mode | Library copy | Runs the core | Primary role |
|---|---:|---:|---|
| Desktop Installation | Complete | Yes | Self-contained local application |
| Docker Installation | Complete | Yes | Self-hosted or always-on application |
| Self-hosted Sync Home | Complete | Yes | Synchronization and Companion access |
| Managed Sync Home | Complete | Yes | Paid, operated synchronization and Companion access |
| Companion | Cache only | No | Mobile access to a reachable Installation |

A desktop Installation may contribute its engines to its Sync Home through the existing
runner capability. This lets mobile requests wait at the always-on Home until a capable
desktop reconnects, without making engine configuration portable.

## Data ownership

### Library Data

These concepts follow the Library between synchronized Installations:

| Concept | Current representation | Rule |
|---|---|---|
| Chess accounts | `Account` | Portable owner identities |
| Games | `Game` | Portable, effectively immutable after import |
| Notes | `Note` | Portable authored content; concurrent edits must be preserved |
| Saved lines | `Line` | Portable authored content; concurrent edits must be preserved |
| Analysis artifacts | Completed `AnalysisRun` and `MoveEval` data | Portable immutable results |
| Analysis meaning | Thresholds, Maia levels and analysis budgets in `AppSetting` | Portable Library preferences |

### Rebuildable Library projections

These are Library-derived but need not be transferred as independent facts:

| Concept | Current representation | Source of truth |
|---|---|---|
| Positions and game occurrences | `Position`, `GamePosition` | Games and their moves |
| Game cards | `Game.card` | Games and completed analysis artifacts |
| Note search index | SQLite FTS tables | Notes |
| Explorer and statistics results | Queries over stored Library Data | Games and analysis artifacts |

Rebuilding a projection must not change the meaning of the Library.

### Device-local Data

These concepts remain with one Installation:

| Concept | Current representation |
|---|---|
| Owner password and browser sessions | `Credential`, `AuthSession` |
| MCP credentials | `McpKey` |
| Engines, executable paths and options | `Engine` |
| Runner registration and connectivity | `Runner` |
| Engine role assignments | Engine-role keys in `AppSetting` |
| Queue pause and unfinished analysis work | Queue setting and non-completed `AnalysisRun` rows |
| Import execution and cursors | `ImportJob` |
| Live boards, streams and event subscriptions | In-memory runtime state |
| Downloaded engines, weights and temporary uploads | Installation filesystem |
| Sync credentials, outgoing changes and cursors | Future local synchronization state |

Two current representations therefore mix concepts that have different ownership:

- `AppSetting` contains portable Library preferences as well as Device-local engine and
  queue configuration.
- `AnalysisRun` represents both local work in progress and a portable completed Analysis
  Artifact.

The distinction belongs to the domain even if a later implementation continues storing the
concepts together.

## Behavioural scenarios

**Offline desktop:** A desktop Installation can import, analyze, annotate, and browse while
offline. When it reconnects, its Library changes travel through the Sync Home.

**Mobile while desktop sleeps:** The Companion reads and writes through the Sync Home. Its
changes reach desktop Installations when they reconnect.

**Concurrent note editing:** Neither edit is silently discarded. The Library retains enough
information for the Owner to choose or combine the conflicting versions.

**Analysis on another machine:** A completed Analysis Artifact follows the Library. Engine
installation, queue state, and the process that produced it remain Device-local.

**Lost device:** Revoking a device prevents future access but does not delete Library Data
already synchronized to other Installations.

## Decisions still required before synchronization work

- Retention and recovery rules for Library deletions.
- Storage and transfer limits for Analysis Artifacts in Managed Sync.
- Recovery policy for Managed Sync credentials and encrypted backups.
- Compatibility window between Installations running different Blunderbase versions.
