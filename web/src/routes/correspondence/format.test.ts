import { i18n } from '@lingui/core'
import { describe, expect, it } from 'vitest'

import type { CorrespondenceGameSummary } from '@/lib/api/types'

import {
  dateInputToIso,
  dateInputValue,
  duePhrase,
  dueTone,
  iccfNumber,
  rowAsWhite,
  opponentOf,
  ownerColor,
  sections,
  type DuePhrase,
} from './format'

/** The deadline as the page prints it — the same call both screens make. */
function say(phrase: DuePhrase | null): string {
  return phrase ? i18n._({ ...phrase.message, values: phrase.values }) : ''
}

function game(patch: Partial<CorrespondenceGameSummary> = {}): CorrespondenceGameSummary {
  return {
    game_id: 1,
    white: 'Baum',
    black: 'Kowalski, Marek',
    owner_color: 'white',
    source: 'iccf',
    source_id: '1258402',
    result: '*',
    state: 'ongoing',
    finished: false,
    ply_count: 32,
    move_number: 17,
    to_move: 'white',
    your_move: true,
    moves_uci: [],
    moves_san: [],
    start_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    created_at: '2026-06-03T10:00:00+00:00',
    updated_at: '2026-09-08T10:00:00+00:00',
    ...patch,
  }
}

describe('sections', () => {
  it('cuts one ordering into the three the page prints, keeping the order it arrived in', () => {
    const mine = game({ game_id: 1, your_move: true })
    const alsoMine = game({ game_id: 2, your_move: true })
    const theirs = game({ game_id: 3, your_move: false })
    const over = game({ game_id: 4, finished: true, state: 'finished', result: '1-0' })

    const cut = sections([mine, alsoMine, theirs, over])

    expect(cut.yourMove.map((each) => each.game_id)).toEqual([1, 2])
    expect(cut.waiting.map((each) => each.game_id)).toEqual([3])
    expect(cut.finished.map((each) => each.game_id)).toEqual([4])
  })

  it('files a finished game under Finished even where it still claims to be your move', () => {
    const cut = sections([game({ finished: true, your_move: true })])
    expect(cut.yourMove).toHaveLength(0)
    expect(cut.finished).toHaveLength(1)
  })
})

describe('who is who', () => {
  it('names the other player, whichever side the owner is', () => {
    expect(opponentOf(game())).toBe('Kowalski, Marek')
    expect(opponentOf(game({ owner_color: 'black' }))).toBe('Baum')
    expect(ownerColor(game({ owner_color: 'black' }))).toBe('black')
  })

  it('reads an ICCF number only off a game that has one', () => {
    expect(iccfNumber(game())).toBe('1258402')
    expect(iccfNumber(game({ source: 'manual', source_id: null }))).toBeNull()
  })
})

describe('deadlines', () => {
  it('is amber under two days, red past due, and quiet above', () => {
    expect(dueTone(game({ days_left: 9 }))).toBe('calm')
    expect(dueTone(game({ days_left: 1.2 }))).toBe('soon')
    expect(dueTone(game({ days_left: -0.5 }))).toBe('late')
    expect(dueTone(game({ days_left: null }))).toBe('none')
    expect(dueTone(game({ days_left: 3, finished: true }))).toBe('none')
  })

  it('says today rather than "in 0 days", and counts a late reply up', () => {
    // The messages are compiled to hashed ids, so they are compared with each other rather
    // than with their English source: "today" is its own sentence, not "in 0 days".
    expect(duePhrase(0.4)?.values).toEqual({ days: 0 })
    expect(duePhrase(0.4)?.message.id).not.toBe(duePhrase(3.7)?.message.id)
    expect(duePhrase(3.7)?.values).toEqual({ days: 3 })
    expect(duePhrase(-1.2)?.values).toEqual({ days: 2 })
    expect(duePhrase(null)).toBeNull()
  })

  it('counts one day in the singular, which is the commonest deadline there is', () => {
    // The empty catalog the tests activate falls back to the source message, so what is
    // read here is the sentence the component would print in English.
    expect(say(duePhrase(1.4))).toBe('in 1 day')
    expect(say(duePhrase(3.7))).toBe('in 3 days')
    expect(say(duePhrase(-0.5))).toBe('1 day late')
    expect(say(duePhrase(-2.2))).toBe('3 days late')
  })
})

describe('the date box', () => {
  it('makes a round trip through the input without moving the day', () => {
    const iso = dateInputToIso('2026-09-14')
    expect(iso).not.toBeNull()
    expect(dateInputValue(iso)).toBe('2026-09-14')
  })

  it('reads nothing out of an empty box and nothing out of nonsense', () => {
    expect(dateInputToIso('')).toBeNull()
    expect(dateInputToIso('not a date')).toBeNull()
    expect(dateInputValue(null)).toBe('')
    expect(dateInputValue('not a date')).toBe('')
  })
})

describe('rowAsWhite', () => {
  // The node after 1.e4: Black is to move, so a stored row is in Black's frame and has to
  // be turned; after 1.e4 e5 White is to move and the row already is White's.
  const afterE4 = { turn: 'black' } as const
  const afterE5 = { turn: 'white' } as const

  it('turns a row stored from the side to move into White\'s frame', () => {
    expect(rowAsWhite({ cp: -30 }, afterE4)).toEqual({ cp: 30, mate: undefined })
    expect(rowAsWhite({ mate: -4 }, afterE4)).toEqual({ cp: undefined, mate: 4 })
  })

  it('leaves a row alone where White is the side to move', () => {
    const row = { cp: -30, depth: 40 }
    expect(rowAsWhite(row, afterE5)).toBe(row)
  })

  it('keeps everything that is not a score, and passes nothing through as null', () => {
    expect(rowAsWhite({ cp: 12, depth: 51, engine_name: 'Stockfish 17' }, afterE4)).toEqual({
      cp: -12,
      mate: undefined,
      depth: 51,
      engine_name: 'Stockfish 17',
    })
    expect(rowAsWhite(null, afterE4)).toBeNull()
    expect(rowAsWhite({ cp: 30 }, null)).toEqual({ cp: 30 })
  })
})
