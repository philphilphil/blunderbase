import { Plural, Trans, useLingui } from '@lingui/react/macro'
import type { ReactNode } from 'react'

import { SourceBadge } from '@/components/badges/SourceBadge'
import { Badge, Readout } from '@/components/ui/badge'
import { TextLink } from '@/components/ui/text-link'
import type { GameSummary, LiveState } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { isVariation, plyLabel } from './live'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-hairline py-1.5 last:border-b-0">
      <span className="w-20 flex-none text-label text-dim">{label}</span>
      <div className="min-w-0 flex-1 text-right text-data text-body">{children}</div>
    </div>
  )
}

/**
 * What the live board is: the game and ply it follows, the moves played past it, and the
 * marks currently drawn on it.
 *
 * Everything here is a fact, so it is drawn as one (docs/design/README.md, "Controls"):
 * the viewer count a flat readout, the moves played past the game borderless tints, the
 * followed game a link and nothing else. Boxed moves had read as buttons nobody could press.
 */
export function SessionMeta({
  state,
  game,
  className,
}: {
  state: LiveState
  game: GameSummary | undefined
  className?: string
}) {
  const marks = state.arrows.length + state.squares.length
  const { t } = useLingui()
  const arrows = state.arrows.length
  const squares = state.squares.length
  const followed = state.game_id

  return (
    <section className={cn('flex flex-col rounded-xl border border-line bg-panel', className)}>
      <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
        <span className="text-data font-semibold text-ink">
          <Trans>Session</Trans>
        </span>
        <div className="flex-1" />
        <Readout num>
          <Plural value={state.viewer_count} one="# viewer" other="# viewers" />
        </Readout>
      </div>

      <div className="flex flex-col px-3.5 py-2">
        <Row label={t`Board`}>
          {state.game_id ? (
            <TextLink to={`/games/${state.game_id}`}>
              {game ? `${game.white ?? '?'} — ${game.black ?? '?'}` : t`game ${followed}`}
            </TextLink>
          ) : (
            <span className="text-soft">
              <Trans>ad-hoc position</Trans>
            </span>
          )}
        </Row>

        {game ? (
          <Row label={t`Source`}>
            <span className="inline-flex items-center gap-2">
              {game.opening ? (
                <span className="truncate text-data text-soft-2">{game.opening}</span>
              ) : null}
              <SourceBadge source={game.source} size="sm" />
            </span>
          </Row>
        ) : null}

        <Row label={t`Ply`}>
          <span className="font-mono tabular">
            {typeof state.ply === 'number' ? `${state.ply} · ${plyLabel(state.ply)}` : '—'}
          </span>
        </Row>

        <Row label={t`To move`}>
          <span className={state.turn === 'black' ? 'text-soft' : 'text-bright'}>
            {/* Anything the backend sends that is not one of the two colours goes through
                as it stands rather than through a message nobody has written. */}
            {state.turn === 'white'
              ? t`white`
              : state.turn === 'black'
                ? t`black`
                : (state.turn ?? '—')}
          </span>
        </Row>

        <Row label={t`Last move`}>
          <span className="font-mono">{state.last_move ?? '—'}</span>
        </Row>

        <Row label={t`Marks`}>
          <span className="font-mono tabular text-soft">
            <Trans>
              <Plural value={arrows} one="# arrow" other="# arrows" /> ·{' '}
              <Plural value={squares} one="# square" other="# squares" />
            </Trans>
          </span>
        </Row>
      </div>

      {state.moves.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-hairline px-3.5 py-2.5">
          <span className="text-label font-medium text-dim">
            {isVariation(state) ? t`Off the game` : t`Played`}
          </span>
          <div className="flex flex-wrap gap-1">
            {state.moves.map((move, index) => (
              <Badge key={`${move}-${index}`} className="font-mono text-soft">
                {move}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {marks === 0 ? null : (
        <div className="flex flex-col gap-1 border-t border-hairline px-3.5 py-2.5">
          {state.arrows.map((arrow, index) => (
            <div key={`arrow-${index}`} className="flex items-center gap-2 font-mono text-label">
              <span className="size-[0.375rem] rounded-full" style={{ background: color(arrow.color) }} />
              <span className="text-soft">
                {arrow.from}
                <span className="text-faint">→</span>
                {arrow.to}
              </span>
            </div>
          ))}
          {state.squares.map((square, index) => (
            <div key={`square-${index}`} className="flex items-center gap-2 font-mono text-label">
              <span
                className="size-[0.375rem] rounded-[0.0625rem]"
                style={{ background: color(square.color) }}
              />
              <span className="text-soft">{square.square}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** The brush colours from `components/board/brushes.ts`, for the legend swatches. */
function color(brush: string): string {
  switch (brush) {
    case 'red':
      return 'var(--bb-blunder)'
    case 'blue':
      return 'var(--bb-info)'
    case 'yellow':
      return 'var(--bb-inaccuracy)'
    default:
      return 'var(--bb-good)'
  }
}
