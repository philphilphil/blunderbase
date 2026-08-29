/**
 * Serves the browser-hosted Stockfish's three files at `/engine/<name>`, unhashed, in dev
 * and in `dist` alike.
 *
 * Unhashed because nothing imports them: the runner module resolves the glue and the wasm
 * by URL at runtime (`${import.meta.env.BASE_URL}engine/…`), and the *net's* filename comes
 * from the engine itself — it calls back with `getRecommendedNnue`, which answers with the
 * upstream name. Vite's usual `assets/name-<hash>.wasm` would be a URL neither side can
 * predict, so these stay under a fixed prefix with their own names.
 *
 * Separate files, never inlined into a chunk: 600 KB of wasm and 15 MB of weights have no
 * business inside the app bundle, they are fetched only by the tab that opts in to running
 * an engine, and keeping them as their own files is also what keeps the GPL'd Stockfish
 * build distinct from our own JavaScript rather than linked into it.
 *
 * Lives outside `src/` on purpose — it is build plumbing, not application code.
 */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { Plugin } from 'vite'

import { ENGINE_FILES, FETCH_COMMAND, NNUE, nnuePath, packageDir } from './scripts/engine-assets.mjs'

const PREFIX = '/engine/'

/** Content types the dev server has to state itself; `dist` is served by the backend. */
const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.nnue': 'application/octet-stream',
}

/** Every file we publish under `/engine/`, and where it comes from on this machine. */
function sources(): Map<string, string> {
  const map = new Map<string, string>()
  for (const name of ENGINE_FILES) map.set(name, path.join(packageDir, name))
  // The net is not in the package — `scripts/engine-assets.mjs fetch` puts it here.
  map.set(NNUE.name, nnuePath())
  return map
}

export function engineAssets(): Plugin {
  return {
    name: 'blunderbase:engine-assets',

    /**
     * Dev serves the same URLs the build emits, straight off disk, so the runner code needs
     * no branch for which mode it is in. A missing net answers 503 with the command that
     * fixes it rather than taking the dev server down — the rest of the app does not care.
     */
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]!
        if (!url.startsWith(PREFIX)) return next()

        const name = url.slice(PREFIX.length)
        const file = sources().get(name)
        if (file === undefined) {
          res.statusCode = 404
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          res.end(`no engine asset named ${name}; this build serves ${[...sources().keys()].join(', ')}\n`)
          return
        }

        stat(file).then(
          (stats) => {
            res.statusCode = 200
            res.setHeader('content-type', CONTENT_TYPES[path.extname(name)] ?? 'application/octet-stream')
            res.setHeader('content-length', String(stats.size))
            // The glue is loaded as a *worker* script, and a worker is cross-origin isolated
            // only if its own response asks to be — the document's headers do not reach it.
            // Without this the pthread workers die at load with an empty `ErrorEvent`, which
            // names nothing. `backend/api/web.py` serves the same pair over `dist`, so dev
            // and the image agree; a mismatch here is a bug that only appears in one of them.
            res.setHeader('cross-origin-embedder-policy', 'require-corp')
            res.setHeader('cross-origin-resource-policy', 'same-origin')
            createReadStream(file).pipe(res)
          },
          () => {
            res.statusCode = 503
            res.setHeader('content-type', 'text/plain; charset=utf-8')
            res.end(`${name} is not on disk yet — run \`${FETCH_COMMAND}\` in web/\n`)
          },
        )
      })
    },

    /**
     * Emitted as assets with an explicit `fileName`, which is what stops Rollup renaming or
     * hashing them; the bytes go through untouched.
     */
    async generateBundle() {
      for (const [name, file] of sources()) {
        const source = await readFileOrExplain(name, file)
        this.emitFile({ type: 'asset', fileName: `engine/${name}`, source })
      }
    },
  }
}

/** A build with no net would ship a page that cannot start an engine; fail here instead. */
async function readFileOrExplain(name: string, file: string): Promise<Uint8Array> {
  try {
    return await readFile(file)
  } catch {
    throw new Error(`engine asset ${name} is missing at ${file} — run \`${FETCH_COMMAND}\` in web/`)
  }
}
