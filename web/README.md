# Blunderbase web

React 19 · Vite · TypeScript (strict) · Tailwind 4 · shadcn/ui · chessground · Recharts ·
TanStack Query · React Router. Dark only.

```sh
pnpm install
pnpm dev        # http://localhost:5273, proxying /api and /events to 127.0.0.1:8765
pnpm typecheck  # tsc -b --force
pnpm test       # vitest
pnpm build      # tsc -b && vite build
```

The backend has to be running for anything to load: `uv run blunderbase serve` from the
repo root.

## How it is put together

| Where | What |
|---|---|
| `src/index.css` | The design tokens from `docs/design/Blunderbase Game View.dc.html`, the shadcn variable layer mapped onto them, and the chessground board theme. |
| `src/lib/api/` | `types.ts` mirrors `backend/api/schemas.py`; `client.ts` is the fetch wrapper; `endpoints.ts` is one function per route; `keys.ts` is the query-key factory; `queries.ts` the TanStack hooks. |
| `src/lib/events/` | The `/events` socket: `types.ts` (frames), `invalidation.ts` (event → query keys), `EventsProvider.tsx` (reconnect, coalesced invalidation, `subscribe`). |
| `src/lib/chess/` | Evaluation formatting and the win-percentage curve (same constants as the backend), plus the classification/source/tier style tables. |
| `src/components/shell/` | Layout 1a "Studio": titlebar, 200px rail, queue and MCP indicators, `SetPageChrome`. |
| `src/components/board/` | The chessground wrapper and its brushes. |
| `src/routes/<page>/` | One directory per screen. Add files freely inside your own directory; `src/app/router.tsx` and the shell should not need to change. |

Freshness comes from the socket, not from polling: the backend emits `import.*`,
`analysis.*`, `note.*` and `live.updated`, and `invalidationsFor` decides what that makes
stale. A page that renders live-session state subscribes with `useLiveUpdates`.

Adding a shadcn component: `pnpm dlx shadcn@latest add <name>` — `components.json` is set
up for it (`@/components/ui`, `@/lib/utils`).
