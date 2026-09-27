import { describe, expect, it } from 'vitest'

import { decodePgn, readPgnFile } from './pgnFile'

const TEXT = '[White "Müller"]\n[Black "Pérez"]\n\n1. e4 e5 1-0\n'

/** The text as Windows-1252 bytes: one byte per character, ü = 0xFC and é = 0xE9. */
function cp1252(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0))
}

describe('decodePgn', () => {
  it('reads a Windows-1252 file as Windows-1252, not as broken UTF-8', () => {
    expect(decodePgn(cp1252(TEXT))).toBe(TEXT)
  })

  it('reads the bytes only Windows-1252 has, beyond Latin-1', () => {
    // 0x80 is the euro sign and 0x9C "œ" in Windows-1252; Latin-1 has controls there.
    expect(decodePgn(new Uint8Array([0x80, 0x20, 0x9c]))).toBe('€ œ')
  })

  it('leaves valid UTF-8 as it is', () => {
    expect(decodePgn(new TextEncoder().encode(TEXT))).toBe(TEXT)
  })

  it('drops a UTF-8 byte-order mark', () => {
    const bytes = new TextEncoder().encode(`﻿${TEXT}`)
    expect(bytes[0]).toBe(0xef)
    expect(decodePgn(bytes)).toBe(TEXT)
  })

  it('drops a UTF-8 byte-order mark before falling back to Windows-1252', () => {
    // A Notepad UTF-8 file with one Windows-1252 game appended: the BOM must not become
    // "ï»¿" in front of the first tag.
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...cp1252(TEXT)])
    expect(decodePgn(bytes)).toBe(TEXT)
    expect(decodePgn(bytes.buffer)).toBe(TEXT)
  })
})

describe('readPgnFile', () => {
  it('reads a Latin-1 file the browser would otherwise mangle', async () => {
    const file = new File([cp1252(TEXT) as BlobPart], 'chessbase.pgn')
    expect(await file.text()).not.toBe(TEXT)
    expect(await readPgnFile(file)).toBe(TEXT)
  })
})
