# Compute pages — design and plan

Status: **shipped** (2026-09-12) — the prototype, the setting, the two pages and the manual
are in. The prototype is `docs/design/prototypes/compute-pages.html`. This is the design for
splitting the Engines page into two: **Engines** (what is installed and how each is set up)
and **Machines** (where it runs and how much runs at once). It follows
[ARCHITECTURE.md](ARCHITECTURE.md) and changes no service; it moves settings and screens.

Two things the prototype drew differently from what was built: the add-engine form has no
machine choice (a path-based engine is always this server's; the browser engine is the
one-press install on Machines and a runner's come from its yaml), and `Threads` / `Hash`
stay in the UCI options editor under More settings — the row and the card *show* them, and
the budget line reads them, but the editor was not split in two. A runner's slots are also
editable on its card, as they were; the "read-only from its yaml" line in the prototype was
wrong about that.

## The problem

The Engines page is one screen with three sections — what runs what, the engine inventory,
compute capacity — and the numbers that decide how much runs at once are spread over four
homes that nobody can add up in their head:

| Number | Where it lives today |
|---|---|
| Engine processes the queue may run on this server | `BLUNDERBASE_ANALYSIS_CONCURRENCY`, an environment variable; not on any page |
| Correspondence search slots on this server | Analysis → Correspondence → Search slots |
| A runner's slots | its own card in the capacity grid, set when it was registered |
| `Threads` and `Hash` | each engine's card, under More settings |

The manual's "two slots and a concurrency of six are up to eight engine processes" paragraph
is the symptom: the page cannot say it, so the manual has to. And the two names — *slots*
on a runner, *concurrency* on the server — are one concept with two words.

The confusion has a shape. There are three kinds of thing:

- **A machine** has cores and a number of engine processes it may run at once.
- **An engine** is a binary with options; `Threads` and `Hash` are per process of it.
- **A job** — quick, deep, human moves, a correspondence search or task — is what an engine
  is asked to do.

The page mixes the first two: engines are created inside a machine's card, a runner's
engines are listed twice, and the only capacity number the owner can edit is on a different
page under a different heading.

## The two pages

A rail heading **Compute** with two rows, the way Library and Analysis already work: a page
per row, its own URL, its own (?) chapter, its own palette entry. No tabs; the app has none
on a settings screen and a hint like "give this deployment an engine of its own to search
with" needs a page to link to.

**Engines** — what you have.

- *What runs what* stays at the top, unchanged in behaviour: three pickers, the backend's
  own sentence under a role that cannot run. It stays here rather than getting a page of
  its own because it is three dropdowns, and the failure it reports names an engine.
- *Engines*: the flat list across machines, one row per engine — name, kind, machine,
  `Threads`, `Hash`, jobs, state — with the editor under the row as now. `Threads` and
  `Hash` are on the row and named on the card, because they are the two options every
  capacity question is about; they are edited with the rest of the UCI options under More
  settings.
- *Add an engine* moves here from the server card, in the page head. A path-based engine
  is always this server's, so the form asks nothing about where.
- Nothing about capacity. One line under the table says where it went.

**Machines** — where it runs.

- One card per host, stacked full-width rather than three across: this server, this
  browser, each remote runner. A card is: identity (name, cores, memory, kind), *how much
  at once*, what is running now, and the engines on it with what each is doing.
- *How much at once* on this server is two editable settings: **Queue processes** (today's
  `analysis_concurrency`) and **Search slots** (today's `correspondence_slots`). Under them
  a **budget line** does the arithmetic the manual currently asks the owner to do —
  `queue processes × threads + search slots × threads` against the cores — and says in
  words when both at full load would exceed the machine, with a meter. The threads in the
  sum are the actual rows' `Threads`, the queue's from the engines holding Quick and Deep on
  this host, the searches' from the highest `Threads` among this host's UCI rows.
- A runner's card keeps its collapsible shape: slots and status on the row, the advertised
  engines, rename / resize and revoke in the detail. This browser's card keeps install /
  remove.
- *Add a remote runner* and *How runners work* move to the page head.

## What moves, and what changes underneath

1. **`correspondence_slots`** leaves Analysis → Correspondence for this server's machine
   card. Same key, same restart note. The correspondence settings page keeps `multipv`,
   task nodes, task multipv and stale depth — the numbers about *a search*, not about the
   machine.
2. **`analysis_concurrency` becomes an app setting** (`analysis_concurrency`, default cores
   minus two as now) read at boot like `correspondence_slots`. The environment variable
   stays as an override for Docker and CI: when it is set the field is read-only and says
   so ("set by `BLUNDERBASE_ANALYSIS_CONCURRENCY`"). This is the one backend change: a
   settings key, a read in `adapters/pool.py` and `workers/local_streams.py`, and the
   env-var precedence.
3. **Routes**: `/engines` redirects to `/compute/engines`; `/compute/machines` is new;
   `/compute` redirects to engines. `SideNav` gains the `Compute` entry with two subpages
   and drops `Engines`; the command palette gets a row per page.
4. **Manual**: `operate/engines.md` keeps roles, adding, testing, options, Maia, the
   browser engine, the CLI. `operate/runners.md` becomes the Machines chapter: capacity,
   the budget, this server's two numbers, registering and revoking runners. The
   "Capacity" and "An engine for correspondence" sections move from the first to the
   second, and the correspondence guide's pointer to Search slots follows. Both languages,
   same headings, pinned slugs. `tests/test_manual_content.py` will insist on the new
   setting being documented.
5. **Nothing in `services/` changes** except the settings key; the runner protocol, the
   pool and the correspondence worker are untouched.

## Order of work

0. **The prototype** *(shipped)*. `docs/design/prototypes/compute-pages.html`, both screens.
1. **The setting** *(shipped)*. `analysis_concurrency` as an app setting with the env-var
   override; the workers resolve it when they start; `/runners/status` reports the cap in
   force, its source, the stored value and the cores.
2. **The pages** *(shipped)*. The route split (`/compute/engines`, `/compute/machines`,
   `/engines` redirects), `SideNav`, the palette, the tour; `EnginesPage` without its
   capacity section and with the add form in its head; `MachinesPage` from the existing
   host components plus `ServerCard` with the two caps, the budget line (`capacity.ts`)
   and the restart / env notes; `Threads` / `Hash` on the inventory row.
3. **The manual and the settings page** *(shipped)*. Search slots left the correspondence
   settings page; `operate/runners.md` is the Machines chapter; both languages.

## Settled

- **Compute** is the heading, in German *Rechenleistung*. (2026-09-12)
- The budget line warns on Machines only; the Engines page names the cost per process and
  points across. (2026-09-12)
- This browser keeps its own collapsible card, the same shape as a runner's. (2026-09-12)
