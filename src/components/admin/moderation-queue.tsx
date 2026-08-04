'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { adminDataClient, readableAmplifyError } from '@/lib/amplify/browser-client'

type Item = { id: string; type: 'COMMENT' | 'QUESTION'; text: string; author: string }
export function ModerationQueue() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  async function load() {
    setLoading(true)
    try {
      const [comments, questions] = await Promise.all([
        adminDataClient.models.Comment.listCommentsByStatus({ status: 'PENDING' }, { limit: 50 }),
        adminDataClient.models.AudienceQuestion.listQuestionsByStatus(
          { status: 'PENDING_REVIEW' },
          { limit: 50 },
        ),
      ])
      if (comments.errors?.length) throw new Error(comments.errors[0]?.message)
      if (questions.errors?.length) throw new Error(questions.errors[0]?.message)
      setItems([
        ...comments.data.map((item) => ({
          id: item.id,
          type: 'COMMENT' as const,
          text: item.content,
          author: item.authorDisplayName,
        })),
        ...questions.data.map((item) => ({
          id: item.id,
          type: 'QUESTION' as const,
          text: item.questionText,
          author: item.askerDisplayName,
        })),
      ])
    } catch (caught) {
      setError(readableAmplifyError(caught))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  async function act(item: Item, approve: boolean) {
    try {
      const action =
        item.type === 'COMMENT' ? (approve ? 'APPROVE' : 'REJECT') : approve ? 'APPROVE' : 'REJECT'
      const response = await adminDataClient.mutations.moderateContent({
        targetType: item.type,
        targetId: item.id,
        action,
      })
      if (response.errors?.length) throw new Error(response.errors[0]?.message)
      if (!response.data?.ok) throw new Error(response.data?.message ?? 'कार्य पूरा नहीं हुआ')
      setItems((current) => current.filter((entry) => entry.id !== item.id))
    } catch (caught) {
      setError(readableAmplifyError(caught))
    }
  }
  if (loading) return <p role="status">मॉडरेशन कतार लोड हो रही है…</p>
  return (
    <div>
      {error && (
        <p role="alert" className="mb-4 rounded-card bg-danger-subtle p-3 text-danger">
          {error}
        </p>
      )}
      {items.length ? (
        <div className="space-y-4">
          {items.map((item) => (
            <article
              key={`${item.type}-${item.id}`}
              className="rounded-card border border-border bg-surface p-5 shadow-card"
            >
              <p className="text-xs font-bold text-accent">
                {item.type} · {item.author}
              </p>
              <p className="mt-3 whitespace-pre-wrap">{item.text}</p>
              <div className="mt-4 flex gap-3">
                <Button type="button" size="sm" onClick={() => act(item, true)}>
                  स्वीकार
                </Button>
                <Button type="button" size="sm" variant="danger" onClick={() => act(item, false)}>
                  अस्वीकार
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-card bg-bg-subtle p-8 text-center">
          समीक्षा के लिए कोई सामग्री नहीं है।
        </p>
      )}
    </div>
  )
}
