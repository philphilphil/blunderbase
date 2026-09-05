import { useLingui } from '@lingui/react/macro'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'

import { LibraryManagement } from './LibraryManagement'

/**
 * The non-import half of Library: portable export and deliberate destruction.
 * It is a route rather than a tab so the rail names where these actions live, the URL is
 * linkable, and none of the account/history queries run merely to manage stored data.
 */
export function LibraryManagePage() {
  const { t } = useLingui()
  return (
    <PageBody>
      <SetPageChrome
        breadcrumb={[{ label: t`Library`, to: '/library' }, { label: t`Manage` }]}
        manual="guide/library#manage"
      />
      <PageHeader
        title={t`Manage Library`}
        description={t`Export a portable copy or reset the imported data in this installation.`}
      />
      <LibraryManagement />
    </PageBody>
  )
}
