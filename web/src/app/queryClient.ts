import { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api/client'

/**
 * Freshness comes from the `/events` socket, not from polling: queries stay fresh for a
 * while and are invalidated by name when the backend says something changed.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // A typed 4xx will not become a different answer by being asked again.
          if (error instanceof ApiError && error.status < 500) return false
          return failureCount < 2
        },
      },
    },
  })
}
