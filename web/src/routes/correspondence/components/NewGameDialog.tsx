/**
 * Starting a correspondence game by hand, and starting one from the PGN the server exports.
 *
 * Two dialogs in one file because they fill the same record from two directions: the fields
 * below are what a correspondence game *is*, and the PGN form is the same thing with the
 * names, the event and the moves read out of a paste instead of typed. A reader comparing
 * the two should not have to open two files, and the second must never drift into asking
 * for something the first does not.
 *
 * **Which side you are is required and is not a guess.** Half of what the mode does — whose
 * move it is, when the reply is due, which way the tree reads — is that colour, and a
 * correspondence opponent need not be an account this library has ever seen. So it is a
 * choice with no default, made in the same row as the two names it is about.
 *
 * The due date is a plain `date` input: a deadline is a day, not a moment, and the hour is
 * the server's business (`dateInputToIso` puts it at midday so no timezone moves the day).
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type {
  Color,
  CorrespondenceGameCreate,
  CorrespondencePgnImport,
} from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { dateInputToIso } from '../format'
import { Field, Frame } from './DialogFrame'

/** Empty is "leave it out", never an empty string the backend would have to interpret. */
function text(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** The one control with no default: which of the two names is you. */
function WhichIsYou({
  value,
  onChange,
  white,
  black,
}: {
  value: Color | null
  onChange: (color: Color) => void
  white: string
  black: string
}) {
  const { t } = useLingui()
  const option = (color: Color, label: string) => (
    <button
      key={color}
      type="button"
      aria-pressed={value === color}
      onClick={() => onChange(color)}
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 text-[0.75rem] transition-colors',
        value === color
          ? 'border-accent-teal/40 bg-selected text-ink'
          : 'border-edge text-dim hover:border-edge-hover hover:text-ink',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-2.5 flex-none rounded-full border',
          color === 'white'
            ? 'border-side-white-edge bg-side-white'
            : 'border-side-black-edge bg-side-black',
        )}
      />
      <span className="truncate">{label || (color === 'white' ? t`White` : t`Black`)}</span>
    </button>
  )
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        <Trans>Which one is you</Trans>
      </Label>
      <div role="group" aria-label={t`Which one is you`} className="flex gap-2">
        {option('white', white)}
        {option('black', black)}
      </div>
    </div>
  )
}

export function NewGameDialog({
  pending,
  error,
  onCreate,
  onClose,
}: {
  pending: boolean
  error: string | null
  onCreate: (body: CorrespondenceGameCreate) => void
  onClose: () => void
}) {
  const { t } = useLingui()
  const [white, setWhite] = useState('')
  const [black, setBlack] = useState('')
  const [owner, setOwner] = useState<Color | null>(null)
  const [event, setEvent] = useState('')
  const [iccf, setIccf] = useState('')
  const [url, setUrl] = useState('')
  const [timeControl, setTimeControl] = useState('')
  const [startFen, setStartFen] = useState('')
  const [due, setDue] = useState('')

  const ready = white.trim() !== '' && black.trim() !== '' && owner !== null

  function submit(submitted: FormEvent) {
    submitted.preventDefault()
    if (!ready || pending || owner === null) return
    onCreate({
      white: white.trim(),
      black: black.trim(),
      owner_color: owner,
      event: text(event),
      url: text(url),
      iccf_id: text(iccf),
      time_control: text(timeControl),
      start_fen: text(startFen),
      reply_due: dateInputToIso(due),
    })
  }

  return (
    <Frame
      labelledBy="correspondence-new-title"
      title={<Trans>New correspondence game</Trans>}
      description={
        <Trans>
          The game is stored the moment you create it, with no moves and no analysis pass —
          the tree is its analysis while it runs.
        </Trans>
      }
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="flex gap-3 max-md:flex-col">
          <Field id="cg-white" label={<Trans>White</Trans>} className="flex-1">
            <Input
              id="cg-white"
              value={white}
              autoFocus
              autoComplete="off"
              placeholder={t`Name`}
              onChange={(changed) => setWhite(changed.target.value)}
            />
          </Field>
          <Field id="cg-black" label={<Trans>Black</Trans>} className="flex-1">
            <Input
              id="cg-black"
              value={black}
              autoComplete="off"
              placeholder={t`Name`}
              onChange={(changed) => setBlack(changed.target.value)}
            />
          </Field>
        </div>
        <WhichIsYou value={owner} onChange={setOwner} white={white} black={black} />
        <div className="flex gap-3 max-md:flex-col">
          <Field id="cg-event" label={<Trans>Event</Trans>} className="flex-1">
            <Input
              id="cg-event"
              value={event}
              autoComplete="off"
              placeholder={t`Tournament or section`}
              onChange={(changed) => setEvent(changed.target.value)}
            />
          </Field>
          <Field id="cg-iccf" label={<Trans>ICCF game number</Trans>} className="w-44 flex-none max-md:w-full">
            <Input
              id="cg-iccf"
              value={iccf}
              autoComplete="off"
              inputMode="numeric"
              className="font-mono"
              placeholder={t`optional`}
              onChange={(changed) => setIccf(changed.target.value)}
            />
          </Field>
        </div>
        <div className="flex gap-3 max-md:flex-col">
          <Field id="cg-url" label={<Trans>Link to the game</Trans>} className="flex-1">
            <Input
              id="cg-url"
              value={url}
              autoComplete="off"
              placeholder="https://"
              onChange={(changed) => setUrl(changed.target.value)}
            />
          </Field>
          <Field id="cg-tc" label={<Trans>Time control</Trans>} className="w-44 flex-none max-md:w-full">
            <Input
              id="cg-tc"
              value={timeControl}
              autoComplete="off"
              placeholder={t`10 moves / 50 days`}
              onChange={(changed) => setTimeControl(changed.target.value)}
            />
          </Field>
        </div>
        <div className="flex gap-3 max-md:flex-col">
          <Field id="cg-fen" label={<Trans>Starting position</Trans>} className="flex-1">
            <Input
              id="cg-fen"
              value={startFen}
              autoComplete="off"
              className="font-mono text-[0.6875rem]"
              placeholder={t`FEN — leave empty for the normal array`}
              onChange={(changed) => setStartFen(changed.target.value)}
            />
          </Field>
          <Field id="cg-due" label={<Trans>Reply due</Trans>} className="w-44 flex-none max-md:w-full">
            <Input
              id="cg-due"
              type="date"
              value={due}
              className="font-mono"
              onChange={(changed) => setDue(changed.target.value)}
            />
          </Field>
        </div>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-blunder/28 bg-blunder/5 px-2.5 py-2 text-[0.75rem] text-blunder"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" disabled={!ready || pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            <Trans>Create game</Trans>
          </Button>
        </div>
      </form>
    </Frame>
  )
}

export function ImportPgnDialog({
  pending,
  error,
  onImport,
  onClose,
}: {
  pending: boolean
  error: string | null
  onImport: (body: CorrespondencePgnImport) => void
  onClose: () => void
}) {
  const { t } = useLingui()
  const [pgn, setPgn] = useState('')
  const [owner, setOwner] = useState<Color | null>(null)
  const [event, setEvent] = useState('')
  const [iccf, setIccf] = useState('')
  const [url, setUrl] = useState('')
  const [due, setDue] = useState('')

  const ready = pgn.trim() !== '' && owner !== null

  function submit(submitted: FormEvent) {
    submitted.preventDefault()
    if (!ready || pending || owner === null) return
    onImport({
      pgn: pgn.trim(),
      owner_color: owner,
      event: text(event),
      url: text(url),
      iccf_id: text(iccf),
      reply_due: dateInputToIso(due),
    })
  }

  return (
    <Frame
      labelledBy="correspondence-import-title"
      title={<Trans>Import a correspondence game</Trans>}
      description={
        <Trans>
          Paste the PGN the server exports. Its moves become the game's played line, and its
          headers fill in whatever you leave empty below.
        </Trans>
      }
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="correspondence-pgn">
            <Trans>PGN</Trans>
          </Label>
          <textarea
            id="correspondence-pgn"
            value={pgn}
            autoFocus
            rows={8}
            spellCheck={false}
            onChange={(changed) => setPgn(changed.target.value)}
            placeholder={'[Event "WS/M/168"]\n[White "…"]\n\n1. e4 c5 2. Nf3 d6'}
            className="w-full resize-y rounded-md border border-input bg-elevated px-2.5 py-2 font-mono text-[0.6875rem] leading-[1.6] text-ink outline-none placeholder:text-faint focus-visible:border-accent-teal/50"
          />
        </div>
        <WhichIsYou
          value={owner}
          onChange={setOwner}
          white={t`I am White`}
          black={t`I am Black`}
        />
        <div className="flex gap-3 max-md:flex-col">
          <Field id="ci-event" label={<Trans>Event</Trans>} className="flex-1">
            <Input
              id="ci-event"
              value={event}
              autoComplete="off"
              placeholder={t`overrides the PGN`}
              onChange={(changed) => setEvent(changed.target.value)}
            />
          </Field>
          <Field id="ci-iccf" label={<Trans>ICCF game number</Trans>} className="w-44 flex-none max-md:w-full">
            <Input
              id="ci-iccf"
              value={iccf}
              autoComplete="off"
              inputMode="numeric"
              className="font-mono"
              placeholder={t`optional`}
              onChange={(changed) => setIccf(changed.target.value)}
            />
          </Field>
        </div>
        <div className="flex gap-3 max-md:flex-col">
          <Field id="ci-url" label={<Trans>Link to the game</Trans>} className="flex-1">
            <Input
              id="ci-url"
              value={url}
              autoComplete="off"
              placeholder="https://"
              onChange={(changed) => setUrl(changed.target.value)}
            />
          </Field>
          <Field id="ci-due" label={<Trans>Reply due</Trans>} className="w-44 flex-none max-md:w-full">
            <Input
              id="ci-due"
              type="date"
              value={due}
              className="font-mono"
              onChange={(changed) => setDue(changed.target.value)}
            />
          </Field>
        </div>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-blunder/28 bg-blunder/5 px-2.5 py-2 text-[0.75rem] text-blunder"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" disabled={!ready || pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            <Trans>Import game</Trans>
          </Button>
        </div>
      </form>
    </Frame>
  )
}
