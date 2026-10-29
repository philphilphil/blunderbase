import { useLingui } from '@lingui/react/macro'
import { History } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useGames } from '@/lib/api/queries'
import { relative } from '@/lib/mcp/status'

const SEEN_KEY = 'bb.latestGameSeen'

function readSeen(): number | null {
  try {
    const value = Number(window.localStorage.getItem(SEEN_KEY))
    return Number.isInteger(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function writeSeen(id: number) {
  try {
    window.localStorage.setItem(SEEN_KEY, String(id))
  } catch {
    // Storage refused: the dot clears for this session only.
  }
}

/**
 * The titlebar's way into the game just played, from any screen: the owner finishes a game,
 * comes here for the review, and should not have to go through Games to find it.
 *
 * "Latest" is the newest by when it was *played* — the games list's own default order —
 * not by when it was imported, so a backfill of old games never takes it over. It is an
 * icon alone, like the search beside it: a shortcut is not worth a name and an age in a bar
 * this crowded, so the opponent and the age live in the tooltip and the accessible name. A
 * dot marks a game this browser has not opened yet, and clears once that game's page is
 * visited, however it was reached. Hidden while the library holds no game of the owner's.
 *
 * A ghost icon link (`Button asChild`), the titlebar's own icon-action grammar. The `/games`
 * root it reads is invalidated by every import frame and throttled by the events provider,
 * so a new game turns up here without a query of its own to keep fresh.
 */
export function LatestGame() {
  const { t } = useLingui()
  const { pathname } = useLocation()
  const { data } = useGames({ limit: 1 })
  const game = data?.games[0]
  const [seen, setSeen] = useState(readSeen)
  // The age is in the tooltip, so it has to move while the bar sits there.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const here = game ? pathname === `/games/${game.id}` : false
  // Adjusted during the render rather than in an effect, so the dot is gone in the frame the
  // game opens; only the write to storage waits for the commit.
  if (game && here && seen !== game.id) setSeen(game.id)
  useEffect(() => {
    if (seen !== null) writeSeen(seen)
  }, [seen])

  if (!game) return null

  const opponent = game.opponent ?? t`unknown opponent`
  const age = relative(game.played_at, now)
  const fresh = seen !== game.id && !here
  const label = fresh
    ? t`Open your latest game, not opened yet: vs ${opponent}, ${age}`
    : t`Open your latest game: vs ${opponent}, ${age}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" asChild className="relative flex-none">
          <Link to={`/games/${game.id}`} aria-label={label}>
            <History className="size-4" aria-hidden />
            {fresh ? (
              <span
                className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent-teal"
                aria-hidden
              />
            ) : null}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
