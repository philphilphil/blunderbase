import { describe, expect, it } from 'vitest'

import {
  clearCredential,
  credentialKey,
  readCredential,
  writeCredential,
  type CredentialStore,
} from './credential'

/** A store that behaves; `hostile` below is the private window that does not. */
function memory(entries = new Map<string, string>()): CredentialStore {
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  }
}

/** A browser configured to block site data: every access raises. */
const hostile: CredentialStore = {
  getItem: () => {
    throw new DOMException('denied')
  },
  setItem: () => {
    throw new DOMException('denied')
  },
  removeItem: () => {
    throw new DOMException('denied')
  },
}

const CREDENTIAL = { runnerId: 7, runnerName: 'this browser', token: 'bb_rnr_abc' }

describe('the stored credential', () => {
  it('round-trips under a key that names the deployment', () => {
    const entries = new Map<string, string>()
    const store = memory(entries)
    writeCredential(CREDENTIAL, store)
    expect([...entries.keys()]).toEqual([credentialKey()])
    expect(credentialKey()).toContain('/api')
    expect(readCredential(store)).toEqual(CREDENTIAL)
  })

  it('is gone after clearing, which is not the same as revoking', () => {
    const store = memory()
    writeCredential(CREDENTIAL, store)
    clearCredential(store)
    expect(readCredential(store)).toBeNull()
  })

  it('reads nothing rather than half a credential', () => {
    const entries = new Map<string, string>()
    const store = memory(entries)
    entries.set(credentialKey(), 'not json')
    expect(readCredential(store)).toBeNull()
    entries.set(credentialKey(), JSON.stringify({ runnerId: 7 }))
    expect(readCredential(store)).toBeNull()
    entries.set(credentialKey(), JSON.stringify({ runnerId: '7', token: 'x' }))
    expect(readCredential(store)).toBeNull()
  })

  it('survives a browser that refuses to store anything', () => {
    expect(() => writeCredential(CREDENTIAL, hostile)).not.toThrow()
    expect(readCredential(hostile)).toBeNull()
    expect(() => clearCredential(hostile)).not.toThrow()
    expect(readCredential(null)).toBeNull()
  })
})
