import { Cpu, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/**
 * The one screen that explains rather than shows.
 *
 * Every other page here is the analysis: the numbers on a move, the lines under the board,
 * the shape of a month. None of them has room to say where any of it came from, and the
 * question an owner actually arrives with — why are there two engines, and why does only
 * one of them give me lines — has no other home.
 *
 * A table and three answers rather than an essay. Someone opens this mid-game with a
 * number in front of them they do not recognise; they want the shape of it in ten seconds
 * and then to go back to the board. Anything true but unasked-for is left out on purpose.
 *
 * Under the account menu rather than in the nav. The nav is the library, and a page you
 * read once is not somewhere you go back to the way you go back to your games. It belongs
 * with settings and the assistant config: the shelf for things about the installation
 * rather than about the chess.
 */

/** One explanation. Same card the rest of the app sets a section in; the body sets its own
 *  padding so a table can run to the card's edges. */
function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
        <Icon className="size-3.5 text-faint" aria-hidden />
        <h2 className="text-xs font-semibold text-ink">{title}</h2>
      </div>
      {children}
    </section>
  )
}

/** A row of the comparison: what each engine does about one thing. */
function Compare({ of, stockfish, maia }: { of: string; stockfish: ReactNode; maia: ReactNode }) {
  return (
    <TableRow>
      <TableHead scope="row" className="w-20">
        {of}
      </TableHead>
      {/* Cells never wrap by default; these hold phrases, so on a phone they must, or the
          three columns push the card into a sideways scroll. */}
      <TableCell className="max-md:whitespace-normal">{stockfish}</TableCell>
      <TableCell className="max-md:whitespace-normal">{maia}</TableCell>
    </TableRow>
  )
}

/** A question someone actually asks, and the whole of the answer. */
function Answer({ id, question, children }: { id?: string; question: string; children: ReactNode }) {
  return (
    <div id={id} className="flex flex-col gap-1 px-3.5 py-3">
      <h3 className="text-[0.6875rem] font-semibold text-soft">{question}</h3>
      <p className="text-[0.71875rem] leading-[1.5] text-dim">{children}</p>
    </div>
  )
}

export function HelpPage() {
  return (
    <PageBody>
      <SetPageChrome breadcrumb={[{ label: 'Help' }]} />
      <div className="flex max-w-xl flex-col gap-4">
        <PageHeader title="How analysis works" />

        <Section icon={Cpu} title="Two engines">
          <Table className="[&_tr:last-child]:border-0">
            <TableHeader>
              <TableRow>
                <TableHead className="w-20" />
                <TableHead>Stockfish</TableHead>
                <TableHead>Maia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <Compare of="asks" stockfish="what's best" maia="what a 2000 would play" />
              <Compare of="spends" stockfish="250k – 2M nodes" maia="one look, no search" />
              <Compare of="gives" stockfish="1 line quick, 4 deep" maia="5 moves, each with odds" />
              <Compare
                of="lines?"
                stockfish="yes"
                maia={
                  <>
                    never —{' '}
                    <a href="#no-lines" className="text-accent-teal hover:text-accent-link">
                      why?
                    </a>
                  </>
                }
              />
            </TableBody>
          </Table>
        </Section>

        <div className="flex flex-col divide-y divide-hairline rounded-xl border border-line bg-panel">
          <Answer question="Quick vs deep">
            Quick runs on import. Deep is the one you ask for, and it jumps the queue.
          </Answer>
          <Answer id="no-lines" question="Why Maia never shows a line">
            One look, no search. Instinct is a spread of moves, not a continuation.
          </Answer>
          <Answer question="What a move cost">
            Win&#37; before minus after. 5, 10 and 15 are an inaccuracy, a mistake and a
            blunder.
          </Answer>
        </div>

        <p className="text-[0.6875rem] text-faint">
          Change these numbers under{' '}
          <Link to="/analysis/engine" className="text-accent-teal hover:text-accent-link">
            Engine passes
          </Link>
          .
        </p>
      </div>
    </PageBody>
  )
}
