'use client'

import { ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { useAnnounce, useDictionary } from '@/components/providers'
import { Button } from '@/components/ui/button'
import { userPoolDataClient, readableAmplifyError } from '@/lib/amplify/browser-client'

export function QuestionUpvote({
  questionId,
  initialCount = 0,
}: {
  questionId: string
  initialCount?: number
}) {
  const dict = useDictionary()
  const announce = useAnnounce()
  const [upvoted, setUpvoted] = useState(false)
  const [count, setCount] = useState(initialCount)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    setLoading(true)
    const desired = !upvoted
    try {
      const response = await userPoolDataClient.mutations.toggleQuestionUpvote({
        questionId,
        upvoted: desired,
      })
      if (response.errors?.length) throw new Error(response.errors[0]?.message)
      if (!response.data?.ok) throw new Error(response.data?.message ?? dict.errors.generic)
      setUpvoted(response.data.upvoted ?? desired)
      setCount(response.data.upvoteCount ?? count)
      announce(desired ? dict.questions.upvote : dict.questions.removeUpvote)
    } catch (error) {
      announce(readableAmplifyError(error), 'assertive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      type="button"
      variant={upvoted ? 'primary' : 'outline'}
      size="sm"
      loading={loading}
      aria-pressed={upvoted}
      onClick={toggle}
    >
      <ThumbsUp aria-hidden="true" className="size-4" />
      {count}
      <span className="sr-only">
        {upvoted ? dict.questions.removeUpvote : dict.questions.upvote}
      </span>
    </Button>
  )
}
