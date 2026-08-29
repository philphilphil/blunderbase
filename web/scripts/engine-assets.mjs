/**
 * The pin for the browser-hosted Stockfish, and the fetch that warms its cache.
 *
 * A tab that registers itself as an analysis runner needs three files: the emscripten glue,
 * the wasm beside it, and the NNUE the engine asks for by name at startup. The first two
 * come out of `node_modules/@lichess-org/stockfish-web/`; the net does not ship in the
 * package — upstream downloads it from the Stockfish fishtest server — so we fetch it once
 * at *image build* time and copy it into `dist`. A deployment behind a firewall, or one
 * whose only network is the LAN it is served on, then still has a working engine: nothing
 * is fetched from a third party when a page opens.
 *
 * It is pinned by checksum, and the dependency is pinned to an exact version (no caret,
 * unlike every other dep here) because the two move together: a Stockfish bump changes the
 * wasm *and* the net it recommends, so bumping one without the other gives you an engine
 * that refuses to start. Both edits at once, deliberately, or neither.
 *
 * The filename is itself the content hash — `nn-<first 12 hex of the sha256>.nnue` — which
 * is why a cached file with the right name is also a file with the right bytes, and why the
 * URL never serves different content under the same name.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** The build we ship, of the several the package carries. Single-net: `getRecommendedNnue(0)`. */
export const ENGINE_BUILD = 'sf_18_smallnet'

/** Copied verbatim out of the package; served unhashed so the runner can name them. */
export const ENGINE_FILES = [`${ENGINE_BUILD}.js`, `${ENGINE_BUILD}.wasm`]

export const NNUE = {
  name: 'nn-4ca89e4b3abf.nnue',
  url: 'https://tests.stockfishchess.org/api/nn/nn-4ca89e4b3abf.nnue',
  sha256: '4ca89e4b3abfbe9df13e4f3db2acb64dc6ddc7a9becb2ac1cf388f4d66b3bd94',
  bytes: 15054352,
}

const WEB_ROOT = path.resolve(import.meta.dirname, '..')

/** Where the package's prebuilt glue and wasm live, once `pnpm install` has run. */
export const packageDir = path.join(WEB_ROOT, 'node_modules', '@lichess-org', 'stockfish-web')

/** The download cache. Git-ignored: 15 MB of engine weights do not belong in the tree. */
export function nnuePath() {
  return path.join(WEB_ROOT, '.engine', NNUE.name)
}

/** The command a human should run when the cache is cold — quoted in a few error paths. */
export const FETCH_COMMAND = 'node scripts/engine-assets.mjs fetch'

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Download the net unless it is already cached and intact.
 *
 * A file that hashes wrong is deleted rather than left behind: keeping it would make every
 * later run skip the download and fail somewhere much further from the cause.
 */
export async function fetchNnue() {
  const target = nnuePath()
  const cached = await readFile(target).catch(() => null)
  if (cached !== null && sha256(cached) === NNUE.sha256) {
    console.log(`engine: ${NNUE.name} already cached (${cached.length} bytes)`)
    return target
  }

  console.log(`engine: fetching ${NNUE.name} from ${NNUE.url}`)
  const response = await fetch(NNUE.url)
  if (!response.ok) {
    throw new Error(`engine: ${NNUE.url} answered ${response.status} ${response.statusText}`)
  }
  const body = Buffer.from(await response.arrayBuffer())

  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, body)

  const digest = sha256(body)
  if (digest !== NNUE.sha256) {
    await rm(target, { force: true })
    throw new Error(
      `engine: ${NNUE.name} does not match its pin and has been deleted.\n` +
        `  expected sha256 ${NNUE.sha256} (${NNUE.bytes} bytes)\n` +
        `  got      sha256 ${digest} (${body.length} bytes)`,
    )
  }
  console.log(`engine: cached ${NNUE.name} (${body.length} bytes)`)
  return target
}

// `node scripts/engine-assets.mjs fetch`. Anything else is a typo worth naming.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const command = process.argv[2]
  if (command !== 'fetch') {
    console.error(`usage: ${FETCH_COMMAND}`)
    process.exit(2)
  }
  try {
    await fetchNnue()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
