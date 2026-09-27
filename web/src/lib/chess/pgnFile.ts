/**
 * A PGN file's text, whatever charset it was saved in.
 *
 * `File.text()` always reads UTF-8 and quietly turns every byte it cannot read into U+FFFD,
 * and a PGN is often not UTF-8: the PGN standard's own charset is Latin-1, and ChessBase and
 * most older exports write Windows-1252. Read that way, "Müller" arrives as "M�ller",
 * is stored so, and never matches the owner's name or the same game from another source
 * again. So the bytes are read as strict UTF-8 (a BOM is dropped), and a file that is not
 * valid UTF-8 is read line by line: a line that is valid UTF-8 stays UTF-8, the others are
 * read as Windows-1252 — a superset of Latin-1 that decodes every byte, so the fallback can
 * never fail. Deciding for the whole file would turn every "Müller" of a UTF-8 archive with
 * one ChessBase game appended into "MÃ¼ller". The backend reads files it opens itself the
 * same way (`backend/adapters/pgn_import.py`, `decode_pgn`).
 *
 * Each file is decoded on its own, before the upload joins them: one Latin-1 file among
 * several UTF-8 ones must not decide how the others are read.
 *
 * The Windows-1252 decoder keeps a UTF-8 BOM as "ï»¿", so a UTF-8 file with one stray
 * Windows-1252 game in it would put that in front of its first tag, which then no longer
 * parses as one; the BOM is cut off before the fallback.
 */
export function decodePgn(bytes: ArrayBuffer | Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: true })
  try {
    return utf8.decode(bytes)
  } catch {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const bom = view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf
    const cp1252 = new TextDecoder('windows-1252')
    const lines: string[] = []
    let start = bom ? 3 : 0
    for (;;) {
      const newline = view.indexOf(0x0a, start)
      const line = view.subarray(start, newline === -1 ? view.length : newline)
      try {
        lines.push(utf8.decode(line))
      } catch {
        lines.push(cp1252.decode(line))
      }
      if (newline === -1) return lines.join('\n')
      start = newline + 1
    }
  }
}

export async function readPgnFile(file: Blob): Promise<string> {
  return decodePgn(await file.arrayBuffer())
}
