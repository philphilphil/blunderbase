/**
 * A model game from one of the reference books, in the game view — the same one a game of
 * the owner's own opens in.
 *
 * It used to be a viewer of its own: a board, a movetext, and the argument that the studio
 * was welded to a library game and a stripped-down copy of it would read as a broken
 * version of the game view. The argument was wrong in the direction that mattered. Almost
 * everything the studio does that is worth doing to a game nobody has analysed works off the
 * *position*, not off the library row — the live engine search, Maia's read, the analysis
 * board a piece can be dragged on, the opening book, the kept lines — and the reduced viewer
 * had none of it. It also meant two screens to improve every time the game view improved.
 *
 * So the studio takes its game from either source (`routes/game/referenceGame.ts` shapes a
 * reference game like a library one) and this route is now four lines of parameter checking
 * over it. What a model game does not have it does not pretend to have: no evaluations, no
 * classifications, no runs, no notes — the studio reads it as a game nobody has analysed
 * yet, which is what it is.
 *
 * **Nothing here is the owner's.** The game is fetched, replayed in the browser and
 * forgotten: no analysis, no notes, no row in the library. That is the wall issue #3 draws
 * between the reference sources and the database, and the studio's `readOnly` is the far
 * side of it — every affordance that would write something is left out rather than shown
 * refusing. The one door through is "Add to library" in the chrome bar, which stores the
 * game as one the owner did not play and navigates to the real thing.
 */
import { useParams } from 'react-router-dom'

import type { ReferenceSource } from '@/lib/api/types'
import { GameStudio } from '@/routes/game/GamePage'
import { GameLoadError } from '@/routes/game/components/GameStates'
import { parseSource } from '@/routes/explorer/reference'

export function ReferenceGamePage() {
  const { source: sourceParam, gameId } = useParams<{ source: string; gameId: string }>()
  // `parseSource` answers `mine` for anything that is not one of the two books, which is
  // exactly the check this route needs: a hand-typed `/reference/nonsense/x` is a bad URL,
  // not a request to fetch something.
  const parsed = parseSource(sourceParam ?? null)
  if (parsed === 'mine' || !gameId) {
    return (
      <GameLoadError
        error={new Error(`“${sourceParam}/${gameId}” is not a reference game.`)}
        onRetry={() => {}}
      />
    )
  }
  const source: ReferenceSource = parsed
  // Keyed on the game, so walking from one model game to another starts a fresh board
  // rather than carrying the previous one's cursor and orientation over — the same rule
  // `/games/:id` follows.
  return (
    <GameStudio key={`${source}:${gameId}`} game={{ kind: 'reference', source, id: gameId }} />
  )
}
