import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/field'
import { SEARCH_TERM_LIMITS } from '@/lib/domain/search'
import { getDictionary } from '@/lib/i18n/hi'

/**
 * The feed search box.
 *
 * A PLAIN GET FORM, AND A SERVER COMPONENT. No 'use client', no
 * useSearchParams, no Suspense boundary, no state. Submitting navigates to
 * `/?q=…` and the homepage renders the results server-side.
 *
 * That is the whole design, and it is deliberate rather than lazy. The
 * homepage's defining property is that no JavaScript reaches the reader —
 * "the feed is HTML", as (public)/page.tsx puts it — and a filter-as-you-type
 * box would have ended that for every visitor, including the ones who never
 * search. It also means search works with JavaScript disabled, on a slow
 * connection before hydration, and from a bookmarked URL, because `?q=` IS
 * the state. There is nowhere for a client copy of it to drift.
 *
 * `next.config.ts` already sends `form-action 'self'`, so the GET is allowed
 * by CSP without touching the policy.
 *
 * WHY NOT `Field`. Field renders a render-prop child under an always-visible
 * label, has no hideLabel escape hatch, and its control carries `mt-1 w-full`
 * — all three fight an inline row. A search box has no hint and no error, so
 * the label wiring it would have bought us is two lines written by hand.
 */

/** One search form per page, so a fixed id is safe and `useId` would only
 *  make this a component that has to be a function for no reason. */
const INPUT_ID = 'feed-search'

export function SearchBox({ q }: { q: string }) {
  const dict = getDictionary()

  return (
    // role="search" makes this a search landmark, so a screen-reader user can
    // jump straight to it instead of tabbing past the masthead every time.
    <form role="search" method="get" action="/" className="mb-6">
      <div className="flex items-start gap-2">
        {/* min-w-0 is what stops a long placeholder from pushing the button
            off a 412px Pixel 7 viewport — a flex item's default min-width is
            auto, not 0, and the e2e suite asserts no horizontal overflow. */}
        <div className="min-w-0 flex-1">
          <label htmlFor={INPUT_ID} className="sr-only">
            {dict.search.label}
          </label>
          <TextInput
            id={INPUT_ID}
            type="search"
            name="q"
            defaultValue={q}
            // A courtesy to the typist. The real guard is in the data layer
            // and the resolver, because a URL is not a form.
            maxLength={SEARCH_TERM_LIMITS.max}
            placeholder={dict.search.placeholder}
            // mt-0 undoes controlClass's `mt-1`, which assumes a visible label
            // sits above. min-h-11 matches the button and holds the WCAG 2.5.5
            // 44px target; twMerge lets both win over the base class.
            className="mt-0 min-h-11"
          />
        </div>
        <Button type="submit">{dict.search.submit}</Button>
      </div>

      {/* A link, not a reset button: clearing the search means going back to
          the feed, and that is a navigation. It also needs no JavaScript. */}
      {q.length > 0 && (
        <p className="mt-2">
          <Link href="/" className="text-sm font-semibold text-brand hover:text-brand-hover">
            {dict.search.clear}
          </Link>
        </p>
      )}
    </form>
  )
}
