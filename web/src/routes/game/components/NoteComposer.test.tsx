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

    await user.type(screen.getByLabelText('Note text'), 'the bishop is loose here\n')
    await user.click(elsewhere())

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('the bishop is loose here', [], null)
  })

  it('does not write it a second time when its own note comes back', async () => {
    const user = userEvent.setup()
    const { onSave, view } = draw()

    // Typed with a trailing newline, which is what a bare Enter leaves — the box keeps it
    // and the server stores it trimmed, so the two texts are not equal on the way back.
    await user.type(screen.getByLabelText('Note text'), 'the bishop is loose here\n')
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
})
