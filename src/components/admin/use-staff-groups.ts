'use client'

import { fetchAuthSession } from 'aws-amplify/auth'
import { useEffect, useState } from 'react'

/**
 * The signed-in user's Cognito groups, read from the ID token.
 *
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
    // An inline async IIFE rather than a named function, so there is no
    // dependency for react-hooks/exhaustive-deps to demand.
    void (async () => {
      try {
        const session = await fetchAuthSession()
        const raw = session.tokens?.idToken?.payload['cognito:groups']
        setGroups(Array.isArray(raw) ? raw.map(String) : [])
      } catch {
        // No session, or a refresh failure. Treated as "no groups"; the API
        // would refuse the request anyway.
        setGroups([])
      } finally {
        setReady(true)
      }
    })()
  }, [])
  return { groups, ready }
}
