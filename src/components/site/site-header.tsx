'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, MonitorSmartphone, Moon, Search, Sun, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDictionary, useLocale } from '@/components/providers'
import { buttonVariants } from '@/components/ui/button'
import { Wordmark } from '@/components/site/logo'
import { SkipLink } from '@/components/ui/skip-link'
import type { ThemePreference } from '@/components/theme-script'
import { useTheme } from '@/components/use-theme'
import { LOCALE_LABELS, type Locale } from '@/lib/i18n'
import type { Dictionary } from '@/lib/i18n'
import { cn } from '@/lib/utils/cn'

/**
 * The label names the state the button will move TO, not the current one — an
 * icon button's accessible name has to describe its action.
 */
const THEME_LABEL_KEY: Record<ThemePreference, (dict: Dictionary) => string> = {
  light: (dict) => dict.nav.themeDark,
  dark: (dict) => dict.nav.themeSystem,
  system: (dict) => dict.nav.themeLight,
}

const primaryLinks = [
  ['/', 'home'],
  ['/latest', 'latest'],
  ['/opinion', 'opinion'],
  ['/janmat', 'janmat'],
  ['/ask', 'ask'],
  ['/promises', 'promises'],
  ['/live', 'live'],
] as const

export function SiteHeader() {
  const dict = useDictionary()
  const { locale, setLocale } = useLocale()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const { preference, mounted, cycle } = useTheme()
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => setOpen(false), [pathname])

  // Close the mobile panel on Escape, and trap nothing else — the panel is a
  // plain disclosure, not a modal. Without this, a keyboard reader who opened
  // the menu had no way to dismiss it but to tab through every link in it.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/95 shadow-sticky backdrop-blur">
      <SkipLink targetId="content" label={dict.nav.skipToContent} />
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
        <Link href="/" className="mr-auto no-underline">
          <Wordmark siteName={dict.siteName} />
        </Link>

        <nav aria-label={dict.a11y.mainNavigation} className="hidden items-center gap-1 lg:flex">
          {primaryLinks.map(([href, key]) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-semibold no-underline hover:bg-bg-subtle',
                pathname === href && 'bg-brand-subtle text-brand',
              )}
            >
              {dict.nav[key]}
            </Link>
          ))}
        </nav>

        <Link
          href="/search"
          aria-label={dict.nav.search}
          className={buttonVariants({ variant: 'ghost', size: 'icon' })}
        >
          <Search aria-hidden="true" className="size-5" />
        </Link>
        <Link
          href="/account"
          aria-label={dict.nav.account}
          className={buttonVariants({ variant: 'ghost', size: 'icon' })}
        >
          <UserRound aria-hidden="true" className="size-5" />
        </Link>
        {/* Cycles light -> dark -> system. Before hydration the stored
            preference is unreadable, so the icon renders as the neutral
            "system" state rather than guessing and then flipping. */}
        <button
          type="button"
          onClick={cycle}
          aria-label={THEME_LABEL_KEY[preference](dict)}
          className={buttonVariants({ variant: 'ghost', size: 'icon' })}
        >
          {!mounted || preference === 'system' ? (
            <MonitorSmartphone aria-hidden="true" className="size-5" />
          ) : preference === 'dark' ? (
            <Sun aria-hidden="true" className="size-5" />
          ) : (
            <Moon aria-hidden="true" className="size-5" />
          )}
        </button>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={!mounted}
          aria-expanded={open}
          aria-controls="mobile-navigation"
          aria-label={open ? dict.nav.closeMenu : dict.nav.menu}
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'lg:hidden')}
        >
          {open ? (
            <X aria-hidden="true" className="size-5" />
          ) : (
            <Menu aria-hidden="true" className="size-5" />
          )}
        </button>
      </div>

      {open && (
        <nav
          id="mobile-navigation"
          aria-label={dict.a11y.mainNavigation}
          className="border-t border-border bg-surface px-4 py-3 lg:hidden"
        >
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-1">
            {primaryLinks.map(([href, key]) => (
              <Link
                key={href}
                href={href}
                className="touch-target flex items-center rounded-md px-3 py-2 font-semibold no-underline hover:bg-bg-subtle"
              >
                {dict.nav[key]}
              </Link>
            ))}
            <Link
              href="/videos"
              className="touch-target flex items-center rounded-md px-3 py-2 font-semibold no-underline hover:bg-bg-subtle"
            >
              {dict.nav.videos}
            </Link>
            <Link
              href="/about"
              className="touch-target flex items-center rounded-md px-3 py-2 font-semibold no-underline hover:bg-bg-subtle"
            >
              {dict.nav.about}
            </Link>
          </div>
          <div className="mx-auto mt-3 flex max-w-7xl items-center gap-2 border-t border-border pt-3">
            {(['hi', 'en'] as Locale[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setLocale(value)}
                aria-pressed={locale === value}
                className={cn(
                  buttonVariants({ variant: locale === value ? 'primary' : 'outline', size: 'sm' }),
                )}
              >
                {LOCALE_LABELS[value]}
              </button>
            ))}
            <Link
              href="/auth/sign-in"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}
            >
              {dict.nav.signIn}
            </Link>
          </div>
        </nav>
      )}
    </header>
  )
}
