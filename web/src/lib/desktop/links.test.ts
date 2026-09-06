import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { installDesktopLinks } from './links'

const opened = vi.fn<(url: string) => void>()

function click(element: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  element.dispatchEvent(event)
  return event
}

function anchor(attributes: Record<string, string>): HTMLAnchorElement {
  const element = document.createElement('a')
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  element.textContent = 'go'
  document.body.append(element)
  return element
}

beforeAll(() => installDesktopLinks(opened))

afterEach(() => {
  opened.mockClear()
  document.body.replaceChildren()
})

describe('installDesktopLinks', () => {
  it('hands a new-tab link to the shell instead of the webview', () => {
    const link = anchor({ href: '/manual/guide/games/', target: '_blank' })
    const event = click(link)
    expect(event.defaultPrevented).toBe(true)
    expect(opened).toHaveBeenCalledWith(`${window.location.origin}/manual/guide/games/`)
  })

  it('takes the click from an element inside the link', () => {
    const link = anchor({ href: 'https://lichess.org/account/oauth/token', target: '_blank' })
    const icon = document.createElement('span')
    link.append(icon)
    click(icon)
    expect(opened).toHaveBeenCalledWith('https://lichess.org/account/oauth/token')
  })

  it('leaves a same-tab link alone', () => {
    const event = click(anchor({ href: '/games' }))
    expect(event.defaultPrevented).toBe(false)
    expect(opened).not.toHaveBeenCalled()
  })

  it('leaves a click something else already cancelled alone', () => {
    const link = anchor({ href: 'https://github.com/philphilphil/blunderbase', target: '_blank' })
    link.addEventListener('click', (event) => event.preventDefault())
    click(link)
    expect(opened).not.toHaveBeenCalled()
  })

  it('routes window.open the same way and hands back no window', () => {
    expect(window.open('https://blunderbase.org', '_blank', 'noopener')).toBeNull()
    expect(opened).toHaveBeenCalledWith('https://blunderbase.org')
  })

  it('ignores a window.open with nothing to open', () => {
    window.open()
    expect(opened).not.toHaveBeenCalled()
  })
})
