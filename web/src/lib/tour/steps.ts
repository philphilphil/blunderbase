/**
 * The orientation tour: five coachmarks that say what these screens are.
 *
 * Nothing in the app explains itself, and the two people who need it most arrive with the
 * least context — an owner on a first run, looking at an empty library, and a visitor to
 * the public demo, who has read only the landing page. So this is a short orientation and
 * deliberately not a manual: where games come from, the engines that have to be registered
 * before anything runs over them, the gear under the board, what a note is pinned to, and
 * the MCP door onto the same database. Anything longer is the manual.
 *
 * Every step has to say something the reader could not have guessed by clicking. Not chess
 * — they know what an eval bar is — and not the name of a screen they are already standing
 * on: an explorer explains itself the moment you play a move in it, and a menu explains
 * itself when you open it. What is left is what has to be set up before anything runs, what
 * is behind a gear, what a note is quietly attached to, and the second front door.
 *
 * One line per step, and a short one. A coachmark is read standing up, over a screen the
 * reader wants to get back to — a paragraph in it is a paragraph nobody reads, and the
 * step after it pays for that too.
 *
 * A step names a `data-tour` element rather than a CSS path into a screen, so the thing it
 * points at can be rebuilt without the tour noticing; and if the element is not there — an
 * empty library, a disabled surface, a window too narrow for the pane it lives in — the
 * step is skipped rather than pointing at nothing (`TourProvider`).
 *
 * Every anchor here is one that exists at every window width. A step whose anchor only
 * appears on a wide screen would leave the tour on a phone as two coachmarks and a
 * counter that says five.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'

import type { Side } from './place'

/** What the tour knows about the deployment while it is deciding where a step lives. */
export interface TourContext {
  /** The most recent game, for the step that opens one. Null on an empty library. */
  latestGameId: number | null
  /** Whether this installation serves MCP at all; without it there is no page to visit. */
  mcp: boolean
}

export interface TourStep {
  id: string
  title: MessageDescriptor
  body: MessageDescriptor
  /** The `data-tour` attribute of the element this step points at. */
  anchor: string
  /**
   * Where the anchor lives. The tour navigates there first and then looks. A function that
   * answers null is a step this library cannot show — an empty one has no game to open —
   * and the step is skipped; undefined means "wherever we already are".
   */
  route?: string | ((context: TourContext) => string | null)
  /** Which side of the anchor the coachmark prefers; it flips if it does not fit. */
  side: Side
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'library',
    title: msg`Your games come from here`,
    body: msg`Connect Lichess, chess.com or FICS and sync — or drop a PGN anywhere in the window.`,
    anchor: 'sources',
    route: '/library/import',
    side: 'bottom',
  },
  {
    id: 'engines',
    title: msg`Set up your engines`,
    body: msg`Register Stockfish and Maia here and give each job one. Nothing is analysed until you do.`,
    anchor: 'engines',
    route: '/engines',
    side: 'right',
  },
  {
    id: 'board-settings',
    title: msg`The board settings`,
    body: msg`Arrows, the eval graph and the line preview are behind this gear. Or press S.`,
    anchor: 'board-settings',
    route: ({ latestGameId }) => (latestGameId === null ? null : `/games/${latestGameId}`),
    side: 'right',
  },
  {
    id: 'notes',
    title: msg`Notes stick to positions`,
    body: msg`A note pinned to a position comes back in every game that reaches it.`,
    anchor: 'notes',
    route: '/notes',
    side: 'bottom',
  },
  {
    id: 'assistant',
    title: msg`The other front door`,
    body: msg`Point Claude or any MCP client at this database and it reads what the app reads.`,
    anchor: 'assistant',
    route: ({ mcp }) => (mcp ? '/assistant' : null),
    side: 'left',
  },
]

/** Where a step wants to be shown: a path, null when it cannot be shown, or undefined. */
export function routeFor(step: TourStep, context: TourContext): string | null | undefined {
  return typeof step.route === 'function' ? step.route(context) : step.route
}
