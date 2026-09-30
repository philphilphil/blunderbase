/**
 * **Search with…** — one engine, one position, and what if anything should end it.
 *
 * The default is bounded on purpose: the dialog opens on **Stop it at: Minutes, 60**, so
 * pick the engine, press the button, and the slot is back in an hour. An engine left on one
 * position for a day buys three or four plies; the same day spent on the positions at the
 * end of its line and on the opponent's other tries moves the tree far more, which is what
 * tasks are for. **Nothing** is still offered — some positions really are still moving at
 * depth 50 — but it is a choice, not what happens by default. Switching the kind resets the
 * value to that kind's sensible default (depth 45, an hour), so two clicks still do.
 *
 * The engines offered are `GET /correspondence/status`'s `engines[]`, every enabled UCI
 * engine the deployment has; the ones a search cannot run on yet (a runner's, one that
 * drives no board) are greyed with the reason rather than hidden, and the analysis role's is
 * preselected (`EnginePicker`).
 *
 * **Only the marked moves** is `root_moves`: the candidates already under this node, chosen
 * by hand, sent as UCI `searchmoves`. It is offered rather than typed because the moves that
 * matter are already in the tree — a correspondence player is deciding between three of
 * them, and this is how they tell the engine to spend three days on exactly those.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { EnginePicker, preferredEngine } from '@/components/engine-dialog/EnginePicker'
import { Frame } from '@/components/engine-dialog/DialogFrame'
import { LimitField } from '@/components/engine-dialog/LimitField'
import { LinesField } from '@/components/engine-dialog/LinesField'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FilterChip } from '@/components/ui/chip'
import { Label } from '@/components/ui/label'
import type {
  CorrespondenceSearchCreate,
  CorrespondenceSearchEngine,
  CorrespondenceTreeNode,
} from '@/lib/api/types'
import { useNotation } from '@/lib/chess/notationPrefs'

import { sortSiblings } from '../tree'

type LimitKind = 'none' | 'depth' | 'nodes' | 'minutes'

/** What each kind opens on. Nodes has no sensible default: it depends on the engine. */
const LIMIT_DEFAULTS: Record<LimitKind, string> = { none: '', depth: '45', nodes: '', minutes: '60' }
const DEFAULT_LIMIT: LimitKind = 'minutes'

function positive(value: string): number | null {
  const parsed = Number(value.trim())
  return value.trim() === '' || !Number.isFinite(parsed) || parsed < 1
    ? null
    : Math.trunc(parsed)
}

export interface SearchDialogProps {
  node: CorrespondenceTreeNode
  /** Every offered engine; the one flagged `default` is preselected where it can search. */
  engines: CorrespondenceSearchEngine[]
  /** The deployment's `correspondence_multipv`, shown as the placeholder. */
  defaultMultipv: number
  pending: boolean
  error: string | null
  onStart: (body: CorrespondenceSearchCreate) => void
  onClose: () => void
}

export function SearchDialog({
  node,
  engines,
  defaultMultipv,
  pending,
  error,
  onStart,
  onClose,
}: SearchDialogProps) {
  const { t } = useLingui()
  const notate = useNotation()
  const [engineId, setEngineId] = useState<number | null>(preferredEngine(engines, 'search'))
  const [multipv, setMultipv] = useState('')
  const [limit, setLimit] = useState<LimitKind>(DEFAULT_LIMIT)
  const [limitValue, setLimitValue] = useState(LIMIT_DEFAULTS[DEFAULT_LIMIT])

  function chooseLimit(kind: LimitKind) {
    setLimit(kind)
    setLimitValue(LIMIT_DEFAULTS[kind])
  }
  const [restricted, setRestricted] = useState(false)
  const [moves, setMoves] = useState<string[]>([])

  const candidates = sortSiblings(node.children).filter((child) => child.uci)
  // Restricting to nothing would be a search of nothing, so the box only counts while at
  // least one move is picked — the same rule the server applies.
  const rootMoves = restricted && moves.length > 0 ? moves : null
  const ready = engineId !== null && !(restricted && moves.length === 0)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || pending || engineId === null) return
    const value = positive(limitValue)
    onStart({
      node_id: node.id,
      engine_id: engineId,
      multipv: positive(multipv),
      limit_depth: limit === 'depth' ? value : null,
      limit_nodes: limit === 'nodes' ? value : null,
      // The row counts seconds; a person thinks in minutes.
      limit_seconds: limit === 'minutes' && value !== null ? value * 60 : null,
      root_moves: rootMoves,
    })
  }

  const where = node.san ? notate(node.san) : t`the starting position`

  return (
    <Frame
      labelledBy="correspondence-search-title"
      title={<Trans>Search with…</Trans>}
      description={t`One engine on ${where}, for as long as you let it. It keeps its slot until it finishes or you pause it.`}
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>
            <Trans>Engine</Trans>
          </Label>
          <EnginePicker engines={engines} mode="search" value={engineId} onChange={setEngineId} />
          {engines.length > 0 && engineId === null ? (
            <p className="text-label text-mistake">
              <Trans>
                None of these can run a search here: one is needed on this machine that can
                drive a board. Each greyed engine says why under the pointer.
              </Trans>
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-4">
          <LinesField
            id="correspondence-search-multipv"
            value={multipv}
            placeholder={defaultMultipv}
            onChange={setMultipv}
          />
          <LimitField
            label={<Trans>Stop it at</Trans>}
            groupLabel={t`Stop it at`}
            kinds={[
              { kind: 'minutes', label: <Trans>Minutes</Trans> },
              { kind: 'depth', label: <Trans>Depth</Trans> },
              { kind: 'nodes', label: <Trans>Nodes</Trans> },
              { kind: 'none', label: <Trans>Nothing</Trans>, unbounded: true },
            ]}
            kind={limit}
            value={limitValue}
            onKindChange={chooseLimit}
            onValueChange={setLimitValue}
            hint={
              limit === 'none' ? (
                <Trans>
                  Runs until you pause or stop it. Worth it only where the number is still
                  moving between depths; the tree gains more from the time than the root does.
                </Trans>
              ) : (
                <Trans>Left empty, the limit is ignored and it runs on.</Trans>
              )
            }
          />
        </div>

        {candidates.length > 0 ? (
          <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
            <Checkbox
              checked={restricted}
              onCheckedChange={setRestricted}
              label={<Trans>Only the marked moves</Trans>}
              className="self-start"
            />
            <p className="text-meta leading-[1.5] text-dim-2">
              <Trans>
                The engine spends everything on the moves you pick and answers nothing about
                the rest.
              </Trans>
            </p>
            {restricted ? (
              <div role="group" aria-label={t`Only the marked moves`} className="flex flex-wrap gap-1.5 pt-1">
                {candidates.map((child) => {
                  const uci = child.uci as string
                  const on = moves.includes(uci)
                  // A chip: "any of these", set membership, one click each. Every picked
                  // move narrows the search, so an on chip is always the narrowed look.
                  return (
                    <FilterChip
                      key={child.id}
                      on={on}
                      name={notate(child.san ?? uci)}
                      label={<span className="font-mono">{notate(child.san ?? uci)}</span>}
                      onClick={() =>
                        setMoves((was) =>
                          was.includes(uci) ? was.filter((one) => one !== uci) : [...was, uci],
                        )
                      }
                    />
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-label text-blunder">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="submit"
            disabled={!ready || pending}
            title={
              engineId === null
                ? t`Pick an engine that can search here`
                : restricted && moves.length === 0
                  ? t`Pick at least one move, or untick Only the marked moves`
                  : undefined
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            <Trans>Start searching</Trans>
          </Button>
        </div>
      </form>
    </Frame>
  )
}
