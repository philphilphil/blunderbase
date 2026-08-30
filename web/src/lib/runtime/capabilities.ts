import { createContext, useContext } from 'react'

import { SERVER_CAPABILITIES, type RuntimeCapabilities } from '@/lib/api/types'

export const RuntimeCapabilitiesContext =
  createContext<RuntimeCapabilities>(SERVER_CAPABILITIES)

/** Runtime truth from the backend bootstrap; server capabilities are the test/dev default. */
export function useRuntimeCapabilities(): RuntimeCapabilities {
  return useContext(RuntimeCapabilitiesContext)
}
