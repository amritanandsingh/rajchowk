'use client'

import { fetchAuthSession, fetchUserAttributes, getCurrentUser, signOut } from 'aws-amplify/auth'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { readableAmplifyError } from '@/lib/amplify/browser-client'

type Profile = { username: string; email?: string; displayName?: string; groups: string[] }
export function AccountPanel() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    void (async () => {
      try {
        const [user, attrs, session] = await Promise.all([
          getCurrentUser(),
          fetchUserAttributes(),
          fetchAuthSession(),
        ])
        const groups = session.tokens?.idToken?.payload['cognito:groups']
        setProfile({
          username: user.username,
          ...(attrs.email ? { email: attrs.email } : {}),
          ...(attrs.preferred_username ? { displayName: attrs.preferred_username } : {}),
          groups: Array.isArray(groups) ? groups.map(String) : [],
        })
      } catch {
        router.replace('/auth/sign-in?next=/account')
      } finally {
        setLoading(false)
      }
    })()
  }, [router])
  async function logout() {
    try {
      await signOut()
      router.push('/')
      router.refresh()
    } catch (caught) {
      setError(readableAmplifyError(caught))
    }
  }
  if (loading) return <p role="status">खाता लोड हो रहा है…</p>
  if (!profile) return null
  const staff = profile.groups.some((group) => ['ADMIN', 'EDITOR', 'MODERATOR'].includes(group))
  return (
    <div className="rounded-card border border-border bg-surface p-6 shadow-card">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-bold text-fg-muted">नाम</dt>
          <dd className="mt-1">{profile.displayName ?? profile.username}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-fg-muted">ईमेल</dt>
          <dd className="mt-1">{profile.email ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-fg-muted">भूमिका</dt>
          <dd className="mt-1">{profile.groups.join(', ') || 'MEMBER'}</dd>
        </div>
      </dl>
      <div className="mt-6 flex flex-wrap gap-3">
        {staff && (
          <Button type="button" onClick={() => router.push('/admin')}>
            स्टाफ डैशबोर्ड
          </Button>
        )}
        <Button type="button" variant="outline" onClick={logout}>
          साइन आउट
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
