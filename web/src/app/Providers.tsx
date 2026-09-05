import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { PageChromeProvider } from '@/components/shell/PageChrome'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/lib/i18n/I18nProvider'
import { ThemeProvider } from '@/lib/ui/theme'

import { createQueryClient } from './queryClient'

/**
 * The theme, language, query cache, titlebar store and tooltips, in that order. Theming is
 * outermost because it writes to `<html>` rather than to the tree; the language is next
 * because a switch remounts everything under it, and the query cache should survive that.
 * `/events` belongs inside the auth gate: opening it before a desktop launch has replaced
 * its old cookie is a session race.
 */
export function Providers({
  children,
  client,
}: {
  children: ReactNode
  /** Injectable so tests can hand in a client with retries off. */
  client?: QueryClient
}) {
  const [fallback] = useState(createQueryClient)
  return (
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={client ?? fallback}>
          <PageChromeProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </PageChromeProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
