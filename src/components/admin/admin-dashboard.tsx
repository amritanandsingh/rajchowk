'use client'

import Link from 'next/link'
import { fetchAuthSession } from 'aws-amplify/auth'
import { FileText, MessageSquareWarning, Radio, Vote } from 'lucide-react'
import { useEffect, useState } from 'react'
import { readableAmplifyError } from '@/lib/amplify/browser-client'

const cards = [
  {
    href: '/admin/articles',
    title: 'लेख',
    description: 'ड्राफ़्ट, समीक्षा और प्रकाशन',
    Icon: FileText,
  },
  {
    href: '/admin/moderation',
    title: 'मॉडरेशन',
    description: 'टिप्पणियाँ, सवाल और रिपोर्ट',
    Icon: MessageSquareWarning,
  },
  { href: '/janmat', title: 'जनमत', description: 'लाइव पोल का सार्वजनिक दृश्य', Icon: Vote },
  { href: '/live', title: 'लाइव', description: 'आगामी और चल रही चर्चाएँ', Icon: Radio },
]

export function AdminDashboard() {
  const [state, setState] = useState<'loading' | 'allowed' | 'denied'>('loading')
  const [message, setMessage] = useState('')
  useEffect(() => {
    void (async () => {
      try {
        const session = await fetchAuthSession()
        const raw = session.tokens?.idToken?.payload['cognito:groups']
        const groups = Array.isArray(raw) ? raw.map(String) : []
        setState(
          groups.some((group) => ['ADMIN', 'EDITOR', 'MODERATOR'].includes(group))
            ? 'allowed'
            : 'denied',
        )
      } catch (error) {
        setState('denied')
        setMessage(readableAmplifyError(error))
      }
    })()
  }, [])
  if (state === 'loading') return <p role="status">अनुमति जाँची जा रही है…</p>
  if (state === 'denied')
    return (
      <div className="rounded-card bg-danger-subtle p-5 text-danger" role="alert">
        <h2 className="font-bold">प्रवेश निषिद्ध</h2>
        <p className="mt-2 text-sm">{message || 'यह क्षेत्र केवल अधिकृत स्टाफ के लिए है।'}</p>
      </div>
    )
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {cards.map(({ href, title, description, Icon }) => (
        <Link
          key={href}
          href={href}
          className="group rounded-card border border-border bg-surface p-5 text-fg no-underline shadow-card hover:border-brand"
        >
          <Icon aria-hidden="true" className="size-7 text-brand" />
          <h2 className="mt-4 text-xl font-bold group-hover:text-brand">{title}</h2>
          <p className="mt-2 text-sm text-fg-muted">{description}</p>
        </Link>
      ))}
    </div>
  )
}
