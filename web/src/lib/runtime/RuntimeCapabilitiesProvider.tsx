import type { ReactNode } from 'react'

import type { RuntimeCapabilities } from '@/lib/api/types'

import { RuntimeCapabilitiesContext } from './capabilities'

export function RuntimeCapabilitiesProvider({
  capabilities,
  children,
}: {
  capabilities: RuntimeCapabilities
  children: ReactNode
}) {
  return (
    <RuntimeCapabilitiesContext.Provider value={capabilities}>
      {children}
    </RuntimeCapabilitiesContext.Provider>
  )
}
