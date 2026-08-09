'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ArrowLeft,
  FileText,
  LayoutDashboard,
  MessageSquareWarning,
  MonitorSmartphone,
  Moon,
  RefreshCw,
  Sun,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Logo } from '@/components/site/logo'
import { buttonVariants } from '@/components/ui/button'
import { SkipLink } from '@/components/ui/skip-link'
import type { ThemePreference } from '@/components/theme-script'
import { useTheme } from '@/components/use-theme'
import { cn } from '@/lib/utils/cn'
import { useStaffGroups } from './use-staff-groups'

/**
 * Chrome for the staff surfaces.
 *
 * Deliberately not the public header. /admin used to render inside the reader
 * nav — seven news links, the locale switcher, a four-column marketing footer
 * with RSS — which gave an editor no signal about which side of the site they
 * were on, and buried the three links they actually need among fifteen they
 * don't.
 *
 * What is here and why:
 *  - Three destinations, matching the three staff surfaces that exist.
 *  - The signed-in identity is NOT shown: it would need another auth round trip
 *    on every page, and useStaffGroups already gates the content below.
 *  - A visible "back to the site" exit, because the public header is gone and
 *    the wordmark leads to /admin rather than /.
 *  - The theme toggle, kept because working a long shift in a bright newsroom
 *    is exactly when it matters.
 */
const LINKS = [
  { href: '/admin', label: 'डैशबोर्ड', Icon: LayoutDashboard },
  { href: '/admin/articles', label: 'लेख', Icon: FileText },
  { href: '/admin/moderation', label: 'मॉडरेशन', Icon: MessageSquareWarning },
] as const

const THEME_LABEL: Record<ThemePreference, string> = {
  light: 'रात',
  dark: 'सिस्टम',
  system: 'दिन',
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { preference, mounted, cycle } = useTheme()
  const { refreshing, refresh } = useStaffGroups()

  return (
    <div className="min-h-dvh bg-bg-subtle">
      <header className="border-b border-border bg-surface">
        <SkipLink targetId="content" label="मुख्य सामग्री पर जाएँ" />
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Link
            href="/admin"
            className="flex items-center gap-2 no-underline"
            aria-label="स्टाफ डैशबोर्ड"
          >
            <Logo className="size-7" decorative />
            <span className="font-display text-base font-bold text-brand">स्टाफ</span>
          </Link>

          <nav aria-label="स्टाफ नेविगेशन" className="ms-2 flex items-center gap-1">
            {LINKS.map(({ href, label, Icon }) => {
              // Exact match for /admin so the dashboard is not marked current on
              // every child route; prefix match for the others.
              const active = href === '/admin' ? pathname === href : pathname.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold no-underline transition-colors motion-reduce:transition-none',
                    active
                      ? 'bg-brand-subtle text-brand'
                      : 'text-fg-muted hover:bg-bg-subtle hover:text-fg',
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              )
            })}
          </nav>

          <div className="ms-auto flex items-center gap-1">
            {/*
              Cognito bakes `cognito:groups` into the ID token at sign-in, so a
              role granted mid-session is invisible until a new token is minted.
              Without this the only remedy was signing out and back in, and
              nothing on screen said so — a genuine ADMIN simply saw no publish
              button. This forces a fresh token and re-reads the claim.
            */}
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              title="भूमिका ताज़ा करें — नई भूमिका मिलने के बाद उपयोग करें"
              aria-label="भूमिका ताज़ा करें"
              className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            >
              <RefreshCw
                aria-hidden="true"
                className={cn('size-5', refreshing && 'animate-spin motion-reduce:animate-none')}
              />
            </button>
            <button
              type="button"
              onClick={cycle}
              aria-label={THEME_LABEL[preference]}
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
            <Link
              href="/"
              className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'gap-2' })}
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">साइट पर वापस</span>
            </Link>
          </div>
        </div>
      </header>
      {children}
    </div>
  )
}
