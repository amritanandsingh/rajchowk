'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_LOCALE,
  getDictionary,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_TAGS,
  type Dictionary,
  type Locale,
} from '@/lib/i18n'

/* ---------------------------------------------------------------------------
 * Locale
 *
 * Public pages are statically generated, so the server cannot know the reader's
 * cookie without forcing dynamic rendering (which would disable ISR site-wide —
 * the most expensive thing we could do on Amplify Hosting compute).
 *
 * So: the server renders the default locale (Hindi, which is the overwhelming
 * majority of this audience), and this provider reconciles to the cookie on
 * hydration. Readers who have explicitly chosen English see chrome strings
 * settle after hydration on a cached page. Dynamic routes (/admin, /account,
 * /auth) read the cookie server-side and never flash.
 *
 * This is the documented cost of cookie-based locale with no URL prefix. See
 * docs/architecture.md; adding an /en prefix later removes it.
 * ------------------------------------------------------------------------ */

type LocaleContextValue = {
  locale: Locale
  dict: Dictionary
  setLocale: (next: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

function readLocaleCookie(): Locale | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`))
  const value = match?.[1] ? decodeURIComponent(match[1]) : null
  return isLocale(value) ? value : null
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext)
  if (!context) throw new Error('useLocale must be used inside <Providers>')
  return context
}

/** Chrome strings for the active locale. */
export function useDictionary(): Dictionary {
  return useLocale().dict
}

/* ---------------------------------------------------------------------------
 * Screen-reader announcements
 * ------------------------------------------------------------------------ */

type AnnounceContextValue = (message: string, politeness?: 'polite' | 'assertive') => void

const AnnounceContext = createContext<AnnounceContextValue | null>(null)

/**
 * Announce an async result to assistive technology.
 *
 * Every consumer funnels through the two live regions mounted below, so
 * repeated identical messages still get read (the clear-then-set dance is
 * required: NVDA and VoiceOver drop a live-region update whose text is
 * unchanged).
 */
export function useAnnounce(): AnnounceContextValue {
  const announce = useContext(AnnounceContext)
  if (!announce) throw new Error('useAnnounce must be used inside <Providers>')
  return announce
}

export function Providers({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode
  initialLocale?: Locale
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  // Reconcile to the cookie once, on hydration.
  useEffect(() => {
    const fromCookie = readLocaleCookie()
    if (fromCookie && fromCookie !== initialLocale) setLocaleState(fromCookie)
  }, [initialLocale])

  useEffect(() => {
    document.documentElement.lang = LOCALE_TAGS[locale]
  }, [locale])

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) clearTimeout(timer)
    }
  }, [])

  const setLocale = useCallback((next: Locale) => {
    // Not httpOnly: the switcher is a client component and this is not a
    // secret. SameSite=Lax keeps it off cross-site requests.
    document.cookie =
      `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; ` +
      `samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`
    setLocaleState(next)
  }, [])

  const announce = useCallback<AnnounceContextValue>((message, politeness = 'polite') => {
    const set = politeness === 'assertive' ? setAssertive : setPolite
    set('')
    const timer = setTimeout(() => set(message), 100)
    timers.current.push(timer)
  }, [])

  const localeValue = useMemo<LocaleContextValue>(
    () => ({ locale, dict: getDictionary(locale), setLocale }),
    [locale, setLocale],
  )

  return (
    <LocaleContext.Provider value={localeValue}>
      <AnnounceContext.Provider value={announce}>
        {children}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {polite}
        </div>
        <div aria-live="assertive" aria-atomic="true" className="sr-only">
          {assertive}
        </div>
      </AnnounceContext.Provider>
    </LocaleContext.Provider>
  )
}
