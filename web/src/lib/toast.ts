/**
 * The one door onto `sonner`. A call site imports `toast` from here and never from
 * `sonner` directly, so the library stays swappable and the app's own rule about when a
 * toast belongs lives in one comment instead of at every call site.
 *
 * **Inline errors stay for anything a panel owns** — a form that failed to save, a list
 * that could not be read. Those already exist in roughly 160 places across the app and are
 * correct: the failure has somewhere obvious to be read, right beside the control that
 * caused it, and it survives a re-render because it is state, not a timed toast.
 *
 * **A toast is for an action whose failure has no panel of its own** — a button on a row
 * or in a titlebar widget that has nowhere to put a red sentence without disturbing
 * everything around it: pressing "Deep" on a game, queueing a batch, retrying a run.
 *
 * This is a one-way door: existing inline errors are not converted just because a toast
 * now exists. Only new call sites with nowhere else to speak reach for one.
 */
import { toast as sonnerToast } from 'sonner'

export const toast = {
  error: (message: string) => sonnerToast.error(message),
  success: (message: string) => sonnerToast.success(message),
  info: (message: string) => sonnerToast(message),
}
