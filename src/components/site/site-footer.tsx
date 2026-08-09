import { getDictionary } from '@/lib/i18n/hi'

/**
 * The footer.
 *
 * There is deliberately no link to /admin here. Not because the URL is a
 * secret — it is not, and treating it as one would be security theatre — but
 * because an admin sign-in link on a reader-facing page invites credential
 * stuffing from people who were never going to be administrators, and serves
 * no reader. Editors bookmark /admin.
 *
 * The year is computed at render time. Public pages are ISR with a 60-second
 * TTL, so it refreshes long before it can be wrong.
 */
export function SiteFooter() {
  const dict = getDictionary()

  return (
    <footer className="mt-16 border-t border-border py-8">
      <div className="mx-auto max-w-5xl px-4 text-xs text-fg-subtle">
        <p>
          © {new Date().getFullYear()} {dict.siteName}
        </p>
      </div>
    </footer>
  )
}
