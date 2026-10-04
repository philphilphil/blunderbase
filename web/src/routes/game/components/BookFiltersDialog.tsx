/**
 * Which Lichess games the game screen's Book counts: the speeds and the rating bands.
 *
 * The explorer's own controls (`ReferenceFilters`), in the frame every dialog of the game
 * screen wears (`DialogFrame`), so the two places that ask the rated database a question ask
 * it the same way — the one `SpeedPicker`, and the rating bands as chips, of which the last
 * can never be switched off. Every change writes straight through (`bookSource`) and the
 * Book under the dialog answers it at once, so there is nothing to apply: Done just closes.
 * Reset is the explorer's defaults.
 */
import { Trans, useLingui } from '@lingui/react/macro'

import { DialogFooter, Frame } from '@/components/engine-dialog/DialogFrame'
import { Button } from '@/components/ui/button'
import { ReferenceFilters } from '@/routes/explorer/components/ReferenceFilters'

import { resetBookFilters, setBookFilters, useBookFilters } from '../bookSource'

export function BookFiltersDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLingui()
  const filters = useBookFilters()
  return (
    <Frame
      title={<Trans>Lichess games in the book</Trans>}
      description={<Trans>Which rated games count, by speed and by rating.</Trans>}
      labelledBy="book-filters-title"
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <ReferenceFilters
          speeds={filters.speeds}
          ratings={filters.ratings}
          onSpeeds={(speeds) => setBookFilters({ speeds })}
          onRatings={(ratings) => setBookFilters({ ratings })}
        />
      </div>
      <DialogFooter className="justify-between">
        <Button variant="secondary" size="sm" onClick={resetBookFilters}>
          {t`Reset`}
        </Button>
        <Button size="sm" onClick={onClose}>
          <Trans>Done</Trans>
        </Button>
      </DialogFooter>
    </Frame>
  )
}
