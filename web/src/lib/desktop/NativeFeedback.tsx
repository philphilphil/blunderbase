import { useLingui } from '@lingui/react/macro'
import { useEffect, useRef } from 'react'

import { useEventListener } from '@/lib/events/EventsProvider'
import type {
  AnalysisProgressEvent,
  AnalysisRunEvent,
  ImportFinishedEvent,
} from '@/lib/events/types'

import { hasNativeBridge, sendNativeNotification, setNativeProgress } from './nativeBridge'

/** OS notifications and Dock/taskbar progress for work that outlives the current page. */
export function NativeFeedback() {
  const { t } = useLingui()
  const clearProgress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeImports = useRef(0)
  const activeAnalyses = useRef(new Map<number, { done: number; total: number | null }>())
  const finished = useRef({ done: 0, failed: 0 })
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearLater = () => {
    if (clearProgress.current !== null) clearTimeout(clearProgress.current)
    clearProgress.current = setTimeout(() => void setNativeProgress('none'), 600)
  }

  const updateProgress = () => {
    if (clearProgress.current !== null) {
      clearTimeout(clearProgress.current)
      clearProgress.current = null
    }
    if (activeImports.current > 0) {
      void setNativeProgress('indeterminate')
      return
    }
    const analyses = [...activeAnalyses.current.values()]
    if (analyses.length === 0) {
      clearLater()
      return
    }
    if (analyses.some((analysis) => analysis.total === null)) {
      void setNativeProgress('indeterminate')
      return
    }
    const done = analyses.reduce((sum, analysis) => sum + analysis.done, 0)
    const total = analyses.reduce((sum, analysis) => sum + (analysis.total ?? 0), 0)
    void setNativeProgress('normal', total > 0 ? Math.round((done / total) * 100) : 0)
  }

  const queueAnalysisNotification = (failed: boolean) => {
    if (!document.hidden) return
    finished.current[failed ? 'failed' : 'done'] += 1
    if (notificationTimer.current !== null) return
    notificationTimer.current = setTimeout(() => {
      const counts = finished.current
      finished.current = { done: 0, failed: 0 }
      notificationTimer.current = null
      const total = counts.done + counts.failed
      const done = counts.done
      const failed = counts.failed
      const title = failed > 0 ? t`Analysis finished with errors` : t`Analysis complete`
      // Two whole sentences for the many case rather than a clause appended to one: the
      // failure count is part of what is being said, not a suffix.
      const body =
        total === 1
          ? failed
            ? t`One analysis failed. Open Blunderbase for details.`
            : t`One game is ready to review.`
          : failed
            ? t`${done} completed, ${failed} failed.`
            : t`${done} completed.`
      void sendNativeNotification(title, body)
    }, 1_200)
  }

  useEventListener('import.started', () => {
    activeImports.current += 1
    updateProgress()
  })
  useEventListener('import.finished', (event) => {
    const finishedImport = event as ImportFinishedEvent
    activeImports.current = Math.max(0, activeImports.current - 1)
    updateProgress()
    if (!document.hidden) return
    const failed = finishedImport.status === 'failed'
    const stopped = finishedImport.status === 'cancelled'
    const imported = finishedImport.imported
    const skipped = finishedImport.skipped
    const counted = t`${imported} imported, ${skipped} already in the Library.`
    void sendNativeNotification(
      failed ? t`Import failed` : stopped ? t`Import stopped` : t`Import complete`,
      failed ? finishedImport.message || t`Open Blunderbase for details.` : counted,
    )
  })
  useEventListener('analysis.running', (event) => {
    const analysis = event as AnalysisRunEvent
    activeAnalyses.current.set(analysis.run_id, { done: 0, total: null })
    updateProgress()
  })
  useEventListener('analysis.progress', (event) => {
    const progress = event as AnalysisProgressEvent
    activeAnalyses.current.set(progress.run_id, { done: progress.done, total: progress.total })
    updateProgress()
  })
  useEventListener('analysis.done', (event) => {
    activeAnalyses.current.delete((event as AnalysisRunEvent).run_id)
    updateProgress()
    queueAnalysisNotification(false)
  })
  useEventListener('analysis.failed', (event) => {
    activeAnalyses.current.delete((event as AnalysisRunEvent).run_id)
    updateProgress()
    queueAnalysisNotification(true)
  })

  useEffect(
    () => () => {
      if (clearProgress.current !== null) clearTimeout(clearProgress.current)
      if (notificationTimer.current !== null) clearTimeout(notificationTimer.current)
      if (hasNativeBridge()) void setNativeProgress('none')
    },
    [],
  )

  return null
}
