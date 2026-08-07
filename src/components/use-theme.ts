'use client'

import { useCallback, useEffect, useState } from 'react'
import { THEME_STORAGE_KEY, type ThemePreference } from './theme-script'

const ORDER: readonly ThemePreference[] = ['light', 'dark', 'system']

function readStored(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : 'system'
  } catch {
    // Private browsing, or storage disabled. "Follow the OS" is the right
    // fallback: it is what the page already rendered as.
    return 'system'
  }
}

/**
 * The reader's theme preference.
 *
 * Deliberately does NOT re-implement the light/dark decision. The pre-paint
 * script in theme-script.tsx owns that — it has to, because it runs before
 * React exists — and it exposes its own `apply()` as `window.__rcApplyTheme`.
 * Calling back into it is what guarantees the toggle, the first paint and the
 * OS-change listener can never drift apart, which is how the browser chrome
 * ended up contradicting the page in the first place.
 *
 * `mounted` exists because the stored preference is unreadable during SSR:
 * rendering the real state before hydration would be a mismatch.
 */
export function useTheme(): {
  preference: ThemePreference
  mounted: boolean
  cycle: () => void
} {
  const [preference, setPreference] = useState<ThemePreference>('system')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setPreference(readStored())
    setMounted(true)
  }, [])

  const cycle = useCallback(() => {
    const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length] ?? 'system'
    try {
      // 'system' is stored as the ABSENCE of a value, so the bootstrap script's
      // `s !== 'light' && matches` path is the single definition of "follow OS".
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
      else localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Preference will not persist, but the class swap below still applies.
    }
    setPreference(next)
    window.__rcApplyTheme?.()
  }, [preference])

  return { preference, mounted, cycle }
}
