import { useLingui } from '@lingui/react/macro'

import { PickerSelect } from '@/components/ui/native-select'
import {
  DATE_FORMATS,
  setDateFormat,
  useDateFormat,
  writeDate,
  type DateFormat,
} from '@/lib/i18n/dateFormat'

/**
 * The settings menu's date format: Automatic, one of the four orders in figures outright,
 * or words (`lib/i18n/dateFormat` says why each exists).
 *
 * Every option is today's date written that way rather than a pattern like `DD.MM.YYYY`:
 * nobody has to decode which letter is which, and Automatic shows what this browser
 * actually answers, which is the one thing a reader cannot guess. A native select (the
 * picker look) rather than a `Segmented` beside Appearance and Language: six dates do
 * not fit across a 20rem menu.
 */
export function DateFormatPicker() {
  const { t } = useLingui()
  const format = useDateFormat()
  const today = new Date()
  const options = DATE_FORMATS.map((value) => {
    const example = writeDate(today, value)
    return { value, label: value === 'auto' ? t`Automatic (${example})` : example }
  })
  return (
    <PickerSelect<DateFormat>
      label={t`Date format`}
      hideLabel
      value={format}
      options={options}
      onChange={setDateFormat}
      title={t`How dates are written in lists`}
    />
  )
}
