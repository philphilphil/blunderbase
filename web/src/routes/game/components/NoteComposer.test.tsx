/**
 * The composer's one dangerous behaviour: it saves itself when focus leaves it.
 *
 * Everything here is about the round trip that follows. A blur-save posts a new note, the
 * query refetches, and the note comes back as the `note` prop on the very box that wrote it
 * — and the box has to recognise it as *its own*. If it does not, it decides it is holding
 * unsaved text, keeps `id: null`, and the next blur writes the same note again. That is how
 * one note becomes two and then three.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { GameNote } from '../gameModel'
import type { NoteTarget } from '../notesModel'

import { NoteComposer } from './NoteComposer'

const TARGET: NoteTarget = {
  kind: 'mainline',
  gameId: 10,
  ply: 8,
  fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 5 4',
  line: null,
  label: '4…Bc5',
}

/** What `POST /notes` gives back: the text stored, which is the text *trimmed*. */
function stored(text: string, tags: string[] = []): GameNote {
  return {
    id: 77,
    text,
    tags,
    game_id: 10,
    ply: 8,
    fen: TARGET.fen,
    scope: 'game',
    source: 'web',
    created_at: '2026-09-02T10:00:00Z',
    updated_at: '2026-09-02T10:00:00Z',
  } as GameNote
}

function draw(props: Partial<React.ComponentProps<typeof NoteComposer>> = {}) {
  const onSave = vi.fn()
  const view = render(
    <NoteComposer target={TARGET} onSave={onSave} onClose={vi.fn()} {...props} />,
  )
  return { onSave, view }
}

/** Anything outside the composer; clicking it is what "focus left" means here. */
function elsewhere() {
  const outside = document.createElement('button')
  outside.textContent = 'elsewhere'
  document.body.append(outside)
  return outside
}

describe('NoteComposer', () => {
  it('writes what was typed once, trimmed, when focus leaves it', async () => {
    const user = userEvent.setup()
    const { onSave } = draw()

    await user.type(screen.getByLabelText('Note text'), 'the bishop is loose here')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    await user.click(elsewhere())

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('the bishop is loose here', [], null)
  })

  it('saves on Enter, and Shift+Enter is a new line rather than a save', async () => {
    const user = userEvent.setup()
    const { onSave } = draw()

    const box = screen.getByLabelText('Note text')
    await user.type(box, 'first line')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(onSave).not.toHaveBeenCalled()
    await user.type(box, 'second line{Enter}')

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('first line\nsecond line', [], null)
  })

  it('does not write it a second time when its own note comes back', async () => {
    const user = userEvent.setup()
    const { onSave, view } = draw()

    // Typed with a trailing newline, which is what a Shift+Enter leaves — the box keeps it
    // and the server stores it trimmed, so the two texts are not equal on the way back.
    await user.type(screen.getByLabelText('Note text'), 'the bishop is loose here')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    await user.click(elsewhere())
    expect(onSave).toHaveBeenCalledTimes(1)

    // The refetch: the note this box just wrote arrives as its `note` prop.
    view.rerender(
      <NoteComposer
        target={TARGET}
        note={stored('the bishop is loose here')}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByLabelText('Note text'))
    await user.click(elsewhere())

    // Nothing changed, so nothing is written — and certainly not a second copy.
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does not write a second copy when the save carried a half-typed tag', async () => {
    const user = userEvent.setup()
    const { onSave, view } = draw()

    await user.type(screen.getByLabelText('Note text'), 'watch the b-file')
    // A tag typed but never committed with Enter still goes with the save…
    await user.type(screen.getByLabelText('Tags'), 'rook')
    await user.click(elsewhere())
    expect(onSave).toHaveBeenCalledWith('watch the b-file', ['rook'], null)

    // …and comes back among the note's own tags, where the box has to recognise it.
    view.rerender(
      <NoteComposer
        target={TARGET}
        note={stored('watch the b-file', ['rook'])}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByLabelText('Note text'))
    await user.click(elsewhere())

    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does not write again while the note it just wrote is still in flight', async () => {
    const user = userEvent.setup()
    const { onSave } = draw()

    await user.type(screen.getByLabelText('Note text'), 'the b-file is the whole game')
    await user.click(elsewhere())
    expect(onSave).toHaveBeenCalledTimes(1)

    // Back into the box and out again before the refetch has landed, so the note still has
    // no id here. Nothing was changed, so nothing more is written.
    await user.click(screen.getByLabelText('Note text'))
    await user.click(elsewhere())

    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does not carry a note it has already written to the next position', async () => {
    const user = userEvent.setup()
    const { onSave, view } = draw()

    await user.type(screen.getByLabelText('Note text'), 'the b-file is the whole game')
    await user.click(elsewhere())

    // The reader steps the board while the save is still in flight. The words are not a
    // draft — they are a note that exists — so they stay where they were written.
    view.rerender(
      <NoteComposer
        target={{ ...TARGET, ply: 12, label: '6…Nf6' }}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Note text')).toHaveValue('')
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('rewrites the note it is holding rather than laying a second one beside it', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <NoteComposer
        target={TARGET}
        note={stored('the bishop is loose here')}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText('Note text'), ' — and so is the knight')
    await user.click(elsewhere())

    expect(onSave).toHaveBeenCalledWith(
      'the bishop is loose here — and so is the knight',
      [],
      77,
    )
  })

  it('carries text nobody saved to wherever the reader has stepped', async () => {
    const user = userEvent.setup()
    const { onSave, view } = draw()

    await user.type(screen.getByLabelText('Note text'), 'this idea belongs two moves later')

    // The board moved before anything was saved: the draft follows, as a *new* note there
    // rather than as a rewrite of whatever hangs on the new position.
    const later = { ...TARGET, ply: 12, label: '6…Nf6' }
    view.rerender(
      <NoteComposer
        target={later}
        note={stored('something else entirely')}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Note text')).toHaveValue('this idea belongs two moves later')
    await user.click(screen.getByLabelText('Note text'))
    await user.click(elsewhere())
    expect(onSave).toHaveBeenCalledWith('this idea belongs two moves later', [], null)
  })

  it('has no Position / Game switch, and names the game only when it is on it', async () => {
    const user = userEvent.setup()
    const { view } = draw()
    await user.click(screen.getByLabelText('Note text'))
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByText('about the game')).not.toBeInTheDocument()

    const whole = { kind: 'game', gameId: 10, ply: null, fen: null, line: null, label: 'the game' }
    view.rerender(<NoteComposer target={whole as NoteTarget} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('about the game')).toBeInTheDocument()
  })

  it('keeps a draft when the page points it at the game, and writes it as a new note there', async () => {
    const user = userEvent.setup()
    const { onSave, view } = draw()

    await user.type(screen.getByLabelText('Note text'), 'played this half asleep')

    // The page pointed the box at the game (the Notes tab's game row); the words travel.
    const whole = { kind: 'game', gameId: 10, ply: null, fen: null, line: null, label: 'the game' }
    view.rerender(<NoteComposer target={whole as NoteTarget} onSave={onSave} onClose={vi.fn()} />)
    expect(screen.getByLabelText('Note text')).toHaveValue('played this half asleep')
    expect(screen.getByPlaceholderText('What is worth remembering about this game?')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Note text'))
    await user.click(elsewhere())
    expect(onSave).toHaveBeenCalledWith('played this half asleep', [], null)
  })
})

/**
 * The box at rest is one line, and opens when focus enters it (#45). What matters is that
 * the opening is a change of *classes* on the same textarea — so focus and the caret never
 * move — and that it never folds away something nobody has saved.
 */
describe('NoteComposer folding', () => {
  const box = () => screen.getByTestId('note-composer')

  it('rests as one field, with no tags or buttons under it', () => {
    draw()
    expect(box()).toHaveAttribute('data-state', 'closed')
    expect(screen.getByPlaceholderText('Add a note…')).toBeInTheDocument()
    expect(screen.queryByLabelText('Tags')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save note/ })).not.toBeInTheDocument()
  })

  it('opens when focus enters it, on the same textarea, and folds when it leaves', async () => {
    const user = userEvent.setup()
    draw()
    const text = screen.getByLabelText('Note text')

    await user.click(text)
    expect(box()).toHaveAttribute('data-state', 'open')
    // The very node that was clicked, still focused: opening is not a remount.
    expect(screen.getByLabelText('Note text')).toBe(text)
    expect(text).toHaveFocus()
    expect(screen.getByLabelText('Tags')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('What is worth remembering about this position?'),
    ).toBeInTheDocument()

    // Moving within it (text → tags) is not leaving it.
    await user.click(screen.getByLabelText('Tags'))
    expect(box()).toHaveAttribute('data-state', 'open')

    await user.click(elsewhere())
    expect(box()).toHaveAttribute('data-state', 'closed')
  })

  it('folds once leaving has saved the note', async () => {
    const user = userEvent.setup()
    const { onSave } = draw()

    await user.type(screen.getByLabelText('Note text'), 'the knight is offside')
    await user.click(elsewhere())

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(box()).toHaveAttribute('data-state', 'closed')
    // Folded, not emptied: the note is still what the field holds.
    expect(screen.getByLabelText('Note text')).toHaveValue('the knight is offside')
  })

  it('stays open over a draft it could not save', async () => {
    const user = userEvent.setup()
    const { onSave } = draw({ pending: true })

    // A save already in flight: leaving cannot write this, so the box stays in sight.
    await user.type(screen.getByLabelText('Note text'), 'and the rook too')
    await user.click(elsewhere())

    expect(onSave).not.toHaveBeenCalled()
    expect(box()).toHaveAttribute('data-state', 'open')
    expect(screen.getByLabelText('Note text')).toHaveValue('and the rook too')
  })

  it('stays open while a save has failed, so the error can be read', () => {
    draw({ error: new Error('The server said no.') })
    expect(box()).toHaveAttribute('data-state', 'open')
    expect(screen.getByText('The server said no.')).toBeInTheDocument()
  })

  it('lets a failed save go once the board has moved on from where it failed', () => {
    const error = new Error('The server said no.')
    const { view } = draw({ error })
    expect(box()).toHaveAttribute('data-state', 'open')

    // The page's mutation still carries the same error; the box is somewhere else now.
    view.rerender(
      <NoteComposer
        target={{ ...TARGET, ply: 9, label: '5.O-O' }}
        error={error}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(box()).toHaveAttribute('data-state', 'closed')
    expect(screen.queryByText('The server said no.')).not.toBeInTheDocument()

    // A new failure is a new error, and shows where it happened.
    view.rerender(
      <NoteComposer
        target={{ ...TARGET, ply: 9, label: '5.O-O' }}
        error={new Error('Still no.')}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(box()).toHaveAttribute('data-state', 'open')
    expect(screen.getByText('Still no.')).toBeInTheDocument()
  })

  it('stays open under a press on its caption or padding', async () => {
    const user = userEvent.setup()
    draw({ target: { ...TARGET, kind: 'game', ply: null, fen: null, label: 'the game' } })
    const text = screen.getByLabelText('Note text')

    await user.click(text)
    expect(box()).toHaveAttribute('data-state', 'open')
    // Neither the caption nor the box's own padding takes focus, so a press on them must
    // not hand it to the page.
    await user.click(screen.getByText('about the game'))
    expect(box()).toHaveAttribute('data-state', 'open')
    expect(text).toHaveFocus()
    await user.click(box())
    expect(box()).toHaveAttribute('data-state', 'open')
    expect(text).toHaveFocus()
  })

  it('opens an existing note whole, and its delete button is not lost to the fold', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    draw({ note: stored('the bishop is loose here'), onDelete })

    // At rest it is the note's first line in the field.
    expect(box()).toHaveAttribute('data-state', 'closed')
    expect(screen.getByLabelText('Note text')).toHaveValue('the bishop is loose here')

    await user.click(screen.getByLabelText('Note text'))
    expect(box()).toHaveAttribute('data-state', 'open')
    // Pressing a button in the row keeps focus where it is, so the box cannot fold away
    // from under the pointer between the press and the click.
    await user.click(screen.getByRole('button', { name: 'Delete this note' }))
    expect(onDelete).toHaveBeenCalledWith(77)
    expect(screen.getByLabelText('Note text')).toHaveFocus()
  })

  it('closes on Escape the way it always has, through the page', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn(() => (document.activeElement as HTMLElement | null)?.blur())
    render(<NoteComposer target={TARGET} onSave={vi.fn()} onClose={onClose} />)

    await user.click(screen.getByLabelText('Note text'))
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(box()).toHaveAttribute('data-state', 'closed')
  })
})
