/**
 * **Practise…** — play the position on the board out against the computer.
 *
 * Three questions and nothing else: which side is yours, who answers, and how strong. It
 * wears the engine dialogs' frame (`Frame`), so Escape, the backdrop and the board's keys
 * standing down behave as they do on Analyse….
 *
 * - **Side** opens on the side at the bottom of the board, which is the game owner's unless
 *   the board was flipped — the side the reader is already looking at the game from.
 * - **Opponent** lists every switched-on search engine and Maia. One that cannot answer
 *   right now (its runner away, a runner too old) is greyed with the backend's sentence
 *   written under the picker, the way Analyse… does it, rather than hidden. Maia opens
 *   preselected where it can answer: a practice opponent is most useful when it plays like
 *   a person of a rating, and that is what Maia is.
 * - **Strength** is the engine's own. A slider appears only for an engine that declares
 *   `UCI_Elo`, between the bounds it declared, opening on the reader's Maia target where
 *   that is in range — the rating the owner already said they are working towards. Full
 *   strength is a switch beside it. For Maia the strength is its level, from the levels
 *   this deployment is configured for.
 * - **Think time** is how long an engine searches per move; Maia does not search.
 *
 * Side, opponent and think time are each one value out of a few that are all on screen, so
 * each is the one-of-N `Segmented` (a sunken track, the choice a raised neutral thumb). They
 * had been rows of pressed chips in the selection blue, the look of a data filter.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { DialogFooter, Frame } from '@/components/engine-dialog/DialogFrame'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import type { PracticeOpponents } from '@/lib/api/types'

import {
  MAIA_CHOICE as MAIA,
  preferredOpponent as preferred,
  THINK_TIMES,
  type PracticeOpponent,
  type PracticeSide,
} from '../practice'
import type { PracticeSetup } from '../usePractice'

const STEP = 50

export interface PracticeDialogProps {
  /** `GET /practice/opponents`; `undefined` while it loads. */
  opponents: PracticeOpponents | undefined
  /** Why the list could not be had, if it could not. */
  loadError: string | null
  /** The deployment's Maia levels, first is the target. */
  maiaLevels: number[] | null
  /** The side at the bottom of the board. */
  defaultSide: PracticeSide
  onStart: (setup: PracticeSetup) => void
  onClose: () => void
}

export function PracticeDialog({
  opponents,
  loadError,
  maiaLevels,
  defaultSide,
  onStart,
  onClose,
}: PracticeDialogProps) {
  const { t } = useLingui()
  const [side, setSide] = useState<PracticeSide>(defaultSide)
  // `null` until somebody picks, so the preselection can follow the list in as it loads.
  const [picked, setPicked] = useState<number | typeof MAIA | null>(null)
  const [elo, setElo] = useState<number | null>(null)
  const [full, setFull] = useState(false)
  const [level, setLevel] = useState<number | null>(null)
  const [movetime, setMovetime] = useState<number>(1000)

  const engines = opponents?.engines ?? []
  const maiaReady = opponents?.maia.available === true
  const choice = picked ?? preferred(opponents)
  const engine = typeof choice === 'number' ? engines.find((row) => row.engine_id === choice) : null
  const strength = engine?.strength ?? null
  const target = maiaLevels?.[0] ?? null
  const shownElo = strength
    ? clamp(elo ?? target ?? strength.default, strength.min, strength.max)
    : null
  const maiaLevel = level ?? target

  const ready =
    choice === MAIA ? maiaReady : engine !== null && engine !== undefined && engine.available
  const unavailable = [
    ...engines.filter((row) => !row.available && row.reason),
    ...(opponents && !opponents.maia.available && opponents.maia.reason
      ? [{ engine_id: -1, name: 'Maia', reason: opponents.maia.reason }]
      : []),
  ]

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    let opponent: PracticeOpponent
    if (choice === MAIA) {
      opponent = { kind: 'maia', level: maiaLevel }
    } else if (engine) {
      opponent = {
        kind: 'engine',
        engineId: engine.engine_id,
        name: engine.name,
        elo: strength && !full ? shownElo : null,
        movetimeMs: movetime,
      }
    } else {
      return
    }
    onStart({ side, opponent })
  }

  return (
    <Frame
      labelledBy="practice-dialog-title"
      title={<Trans>Practise from here</Trans>}
      description={t`Play this position out against the computer. The evaluation, the engine lines and Maia stay hidden until you press H; the moves land in the move list as a line you can keep.`}
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>
            <Trans>You play</Trans>
          </Label>
          <Segmented
            label={t`You play`}
            value={side}
            onChange={setSide}
            className="h-8 self-start"
            options={[
              { value: 'white', label: <Trans>White</Trans> },
              { value: 'black', label: <Trans>Black</Trans> },
            ]}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>
            <Trans>Against</Trans>
          </Label>
          {opponents === undefined && loadError === null ? (
            <p className="flex items-center gap-2 text-label text-dim">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              <Trans>Looking for engines…</Trans>
            </p>
          ) : (
            // One opponent of a handful, all on screen: the one-of-N `Segmented`. Its
            // values are strings, so an engine is its id and Maia is `MAIA`; one that
            // cannot answer is offered disabled, its reason written under the control.
            <Segmented
              label={t`Against`}
              value={choice === null ? '' : String(choice)}
              onChange={(next) => setPicked(next === MAIA ? MAIA : Number(next))}
              className="h-auto min-h-8 max-w-full flex-wrap self-start"
              options={[
                ...(opponents && (opponents.maia.available || opponents.maia.reason)
                  ? [{ value: MAIA, label: 'Maia', disabled: !maiaReady }]
                  : []),
                ...engines.map((row) => ({
                  value: String(row.engine_id),
                  label: row.name,
                  disabled: !row.available,
                  title: row.available ? undefined : (row.reason ?? undefined),
                })),
              ]}
            />
          )}
          {loadError ? (
            <p role="alert" className="text-label text-blunder">
              {loadError}
            </p>
          ) : null}
          {opponents && engines.length === 0 && !opponents.maia.available ? (
            <p className="text-label text-dim">
              <Trans>There is no engine here that can play. Add one under Compute › Engines.</Trans>
            </p>
          ) : null}
          {unavailable.map((row) => (
            <p key={row.engine_id} className="text-label text-mistake">
              {row.name}: {row.reason}
            </p>
          ))}
        </div>

        {choice === MAIA && maiaLevels && maiaLevels.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="practice-dialog-level">
              <Trans>Maia level</Trans>
            </Label>
            <NativeSelect
              id="practice-dialog-level"
              value={maiaLevel ?? ''}
              onChange={(event) => setLevel(Number(event.target.value))}
              className="h-8 w-40"
            >
              {maiaLevels.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
            <p className="text-meta leading-[1.5] text-dim-2">
              <Trans>
                Maia plays a move humans at this level play here, drawn by how often they play
                it — so it blunders the way they do.
              </Trans>
            </p>
          </div>
        ) : null}

        {engine ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="practice-dialog-elo">
              <Trans>Strength</Trans>
            </Label>
            {strength && shownElo !== null ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    id="practice-dialog-elo"
                    type="range"
                    min={strength.min}
                    max={strength.max}
                    step={STEP}
                    value={shownElo}
                    disabled={full}
                    onChange={(event) => setElo(Number(event.target.value))}
                    className="w-56 accent-accent-teal disabled:opacity-45"
                  />
                  <span className="w-12 font-mono text-data text-ink tabular-nums">
                    {full ? '—' : shownElo}
                  </span>
                  <Checkbox
                    checked={full}
                    onCheckedChange={(next) => setFull(next)}
                    label={<Trans>Full strength</Trans>}
                  />
                </div>
                <p className="text-meta leading-[1.5] text-dim-2">
                  <Trans>
                    The engine’s own rating limit, from {strength.min} to {strength.max}. It
                    plays weaker moves on purpose, calibrated for about a second a move.
                  </Trans>
                </p>
              </>
            ) : (
              <p className="text-label text-dim">
                <Trans>
                  {engine.name} declares no rating limit, so it plays at full strength.
                </Trans>
              </p>
            )}
          </div>
        ) : null}

        {engine ? (
          <div className="flex flex-col gap-1.5">
            <Label>
              <Trans>Think time</Trans>
            </Label>
            <Segmented
              label={t`Think time`}
              value={String(movetime)}
              onChange={(next) => setMovetime(Number(next))}
              className="h-8 self-start"
              options={THINK_TIMES.map((value) => ({
                value: String(value),
                label: <Trans>{value / 1000} s</Trans>,
              }))}
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="submit"
            disabled={!ready}
            title={ready ? undefined : t`Choose an opponent that can play right now`}
          >
            <Trans>Play</Trans>
          </Button>
        </DialogFooter>
      </form>
    </Frame>
  )
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}
