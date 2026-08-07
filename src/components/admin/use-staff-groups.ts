'use client'

import { fetchAuthSession } from 'aws-amplify/auth'
import { useEffect, useState } from 'react'

/**
 * The signed-in user's Cognito groups, cached for the life of the page.
 *
 * `fetchAuthSession` is not free — it reads and may refresh the token — and it
 * was being called independently by every staff component that needed to know
 * a role. Navigating /admin -> /admin/articles -> back re-decoded the same
 * token on each mount, and the dashboard and the article table each did it
 * separately on the same page.
 *
 * One in-flight promise is shared by every caller. It is deliberately NOT
 * invalidated on a timer: groups change only when an administrator runs
 * scripts/grant-role.ts, and that already requires the user to sign out and
 * back in for the new claim to reach the ID token at all.
 */
let cached: Promise<string[]> | null = null

function loadGroups(): Promise<string[]> {
  cached ??= (async () => {
    try {
      const session = await fetchAuthSession()
      const raw = session.tokens?.idToken?.payload['cognito:groups']
      return Array.isArray(raw) ? raw.map(String) : []
    } catch {
      // No session, or a refresh failure. Treated as "no groups"; the API
      // would refuse the request anyway.
      //
      // The failed promise is dropped rather than cached, so a user who signs
      // in after a failure is not stuck with an empty group list.
      cached = null
      return []
    }
  })()
  return cached
}

/** Test seam: vitest keeps modules between cases, so the cache must be clearable. */
export function resetStaffGroupsCache(): void {
  cached = null
}

/**
 * `ready` exists so a caller can tell "not loaded yet" from "loaded, and this
 * user has no groups" — rendering a permission-denied state during the first
 * paint would flash a false error at every editor.
 *
 * This is for deciding what the UI offers. The authorization boundary is the
 * `allow.group(...)` rules on the AppSync API, which check the same claim
 * server-side. See src/lib/domain/staff-role.ts.
 */
export function useStaffGroups(): { groups: string[]; ready: boolean } {
  const [groups, setGroups] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    void loadGroups().then((result) => {
      // Guard the unmount case: a staff member who navigates away before the
      // token resolves must not trigger a setState on a dead component.
      if (!active) return
      setGroups(result)
      setReady(true)
    })
    return () => {
      active = false
    }
  }, [])
  return { groups, ready }
}
