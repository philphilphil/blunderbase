import { i18n } from '@lingui/core'
import { describe, expect, it } from 'vitest'

import { ruleParts } from './ruleParts'

describe('ruleParts', () => {
  it('reads the league rule the way the games table writes a clock', () => {
    expect(ruleParts({ source: 'lichess', time_control: '2700+45', rated: true }, i18n)).toEqual([
      'Lichess',
      '45+45',
      'rated',
    ])
  })

  it('joins several speeds into one phrase', () => {
    expect(ruleParts({ speed: ['blitz', 'rapid'] }, i18n)).toEqual(['Blitz · Rapid'])
  })

  it('says casual for rated=false, and names side, opening and opponent', () => {
    expect(
      ruleParts({ rated: false, color: 'black', eco: 'B1', opponent: 'kestrel' }, i18n),
    ).toEqual(['casual', 'as black', 'ECO B1', 'vs kestrel'])
  })

  it('is empty for no rule', () => {
    expect(ruleParts(null, i18n)).toEqual([])
    expect(ruleParts({}, i18n)).toEqual([])
  })
})
