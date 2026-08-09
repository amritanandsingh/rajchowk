'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  firstErrorMessage,
  isAuthError,
  readableAmplifyError,
  userPoolDataClient,
} from '@/lib/amplify/browser-client'
import type { PublishAction } from '@/lib/domain/article-status'
import { resultMessage } from '@/lib/domain/result-code'
import { getDictionary } from '@/lib/i18n/hi'

const dict = getDictionary()

/**
 * The publish / unpublish button in the admin list.
 *
 * A tiny client island inside an otherwise server-rendered table. The list
 * itself needs no JavaScript; only this button does, so the dashboard ships
 * roughly one component's worth of client code rather than becoming a
 * client-rendered page with a loading spinner.
 *
 * The error is rendered INLINE next to the row it belongs to rather than as a
 * page-level banner. With several rows on screen, a banner saying "conflict"
 * gives no clue which article it refers to — and CONFLICT is the most likely
 * failure here, because it is what a second admin's stale dashboard produces.
 */
export function StatusAction({
  articleId,
  action,
  articleTitle,
}: {
  articleId: string
  action: PublishAction
  /** Used only for the accessible name. Several rows carry identical visible
   *  labels, so "प्रकाशित करें" alone tells a screen-reader user nothing about
   *  which article the button acts on. */
  articleTitle: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    if (pending) return
    setPending(true)
    setError('')

    try {
      const result = await userPoolDataClient.mutations.setArticleStatus({ articleId, action })

      const transportError = firstErrorMessage(result.errors)
      if (transportError) {
        setError(transportError)
        return
      }

      if (!result.data?.ok) {
        setError(resultMessage(result.data?.code))
        // A CONFLICT means this page is stale — someone else already moved the
        // article. Refreshing is the fix, so do it rather than leaving the
        // editor looking at a button that will fail again for the same reason.
        if (result.data?.code === 'CONFLICT') router.refresh()
        return
      }

      router.refresh()
    } catch (caught) {
      if (isAuthError(caught)) {
        router.replace('/admin/login?next=/admin')
        return
      }
      setError(readableAmplifyError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={action === 'PUBLISH' ? 'primary' : 'outline'}
        loading={pending}
        onClick={run}
        aria-label={`${dict.admin.actions[action]}: ${articleTitle}`}
      >
        {dict.admin.actions[action]}
      </Button>
      {error && (
        <p role="alert" className="max-w-56 text-end text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
