'use client'

import { fetchAuthSession } from 'aws-amplify/auth'
import { useCallback, useEffect, useState } from 'react'

/**
 * The signed-in user's Cognito groups, cached for the life of the page.
 *
 * `fetchAuthSession` is not free — it reads and may refresh the token — and it
 * was being called independently by every staff component that needed to know
 * a role. Navigating /admin -> /admin/articles -> back re-decoded the same
 * token on each mount, and the dashboard and the article table each did it
 * separately on the same page.
 *
 * One in-flight promise is shared by every caller, and it is not invalidated on
 * a timer: groups change only when an administrator runs scripts/grant-role.ts.
 *
 * That reasoning had a hole. Because the cache never expired AND `cognito:groups`
 * is fixed at sign-in, a staff member promoted mid-session had no way to pick up
 * the new role short of signing out — and nothing in the UI said so, so it
 * presented as "I am an ADMIN but there is no publish button". `refreshStaffGroups`
 * below closes that: it forces Cognito to mint a new ID token and re-reads the
 * claim.
 */
let cached: Promise<string[]> | null = null

function loadGroups(forceRefresh = false): Promise<string[]> {
  if (forceRefresh) cached = null
  cached ??= (async () => {
    try {
      // `forceRefresh` makes Cognito mint a NEW ID token instead of returning the
      // cached one. Without it a role grant is invisible: `cognito:groups` is
      // baked into the token at sign-in, so a user promoted to ADMIN mid-session
      // keeps the old claim until it expires — and the module cache above kept
      // even that stale value for the life of the page. The result was an
      // administrator who genuinely was in the ADMIN group but was offered no
      // publish button, because availableActions() was told isAdmin = false.
      // The server refuses on the same stale claim, so this was never merely a
      // display bug.
      const session = await fetchAuthSession(forceRefresh ? { forceRefresh: true } : {})
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
 * Discard the cached groups and re-read them from a freshly minted ID token.
 *
 * This is the in-app equivalent of "sign out and back in", which is what
 * scripts/grant-role.ts otherwise has to tell every newly promoted staff member
 * to do. Exposed in the admin shell so a role change can be picked up without
 * losing the session.
 */
export async function refreshStaffGroups(): Promise<string[]> {
  return loadGroups(true)
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
export function useStaffGroups(): {
  groups: string[]
  ready: boolean
  refreshing: boolean
  refresh: () => Promise<void>
} {
  const [groups, setGroups] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
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

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setGroups(await refreshStaffGroups())
      setReady(true)
    } finally {
      setRefreshing(false)
    }
  }, [])

  return { groups, ready, refreshing, refresh }
}
