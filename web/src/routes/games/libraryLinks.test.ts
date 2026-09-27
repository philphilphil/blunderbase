import { describe, expect, it } from 'vitest'

import { carrySort, showsCut } from './libraryLinks'

const cut = new URLSearchParams('color=black&outcome=loss')

describe('showsCut', () => {
  it('matches the same filters in any order', () => {
    expect(showsCut(cut, '?outcome=loss&color=black')).toBe(true)
  })

  it('ignores the sort and the page', () => {
    expect(showsCut(cut, '?color=black&outcome=loss&order=black&direction=desc&page=3')).toBe(
      true,
    )
  })

  it('does not match a narrower or a different cut', () => {
    expect(showsCut(cut, '?color=black&outcome=loss&eco=B01')).toBe(false)
    expect(showsCut(cut, '?color=white&outcome=loss')).toBe(false)
    expect(showsCut(cut, '?color=black')).toBe(false)
  })

  it('matches an empty cut only on an unfiltered library', () => {
    const none = new URLSearchParams()
    expect(showsCut(none, '?order=white')).toBe(true)
    expect(showsCut(none, '?color=black')).toBe(false)
  })
})

describe('carrySort', () => {
  it('carries order and direction onto a library link from the library', () => {
    expect(carrySort('/games?eco=B01', '/games', '?order=black&direction=desc&page=2')).toBe(
      '/games?eco=B01&order=black&direction=desc',
    )
    expect(carrySort('/games', '/games', '?order=black')).toBe('/games?order=black')
  })

  it('leaves the link alone off the library, or when it names its own sort', () => {
    expect(carrySort('/games?eco=B01', '/explorer', '?order=black')).toBe('/games?eco=B01')
    expect(carrySort('/games?order=white', '/games', '?order=black')).toBe('/games?order=white')
  })

  it('leaves links elsewhere alone, a game included', () => {
    expect(carrySort('/games/14', '/games', '?order=black')).toBe('/games/14')
    expect(carrySort('/stats', '/games', '?order=black')).toBe('/stats')
  })

  it('changes nothing when the library is in its default order', () => {
    expect(carrySort('/games?eco=B01', '/games', '?page=3')).toBe('/games?eco=B01')
  })
})
