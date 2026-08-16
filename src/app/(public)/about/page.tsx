import type { Metadata } from 'next'
import Link from 'next/link'

import { Container } from '@/components/ui/container'
import { getDictionary } from '@/lib/i18n/hi'

/**
 * What this publication is.
 *
 * Static copy, so there is no data fetch, no `revalidate` and no sibling
 * loading.tsx — there is nothing to wait for. It sits inside the (public)
 * route group so it inherits the skip link, masthead and footer from
 * (public)/layout.tsx; outside that group it would render as a bare page and
 * look like a broken deployment, which is exactly what happened to
 * app/not-found.tsx and why that file renders its own chrome.
 *
 * Rendered as JSX from the dictionary rather than through MarkdownContent.
 * The copy is fixed rather than authored, so routing it through react-markdown
 * and rehype-sanitize would add a renderer, a sanitiser pass and a shared
 * chunk to a page that needs three paragraphs.
 */

const dict = getDictionary()

export const metadata: Metadata = {
  // Flows through the root layout's `%s | राज चौक` template.
  title: dict.about.title,
  description: dict.about.lead,
  alternates: { canonical: '/about' },
}

export default function AboutPage() {
  return (
    <Container width="prose">
      <h1 className="font-display text-3xl font-bold text-balance sm:text-4xl">
        {dict.about.title}
      </h1>

      <p className="mt-4 text-lg text-fg-muted">{dict.about.lead}</p>

      {/* text-article is the Devanagari-tuned size/leading pair — matras sit
          above and below the baseline and collide at Latin line-heights. */}
      <div className="mt-8 space-y-6 text-article">
        {dict.about.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>

      <nav className="mt-12 border-t border-border pt-6">
        <Link href="/" className="text-sm font-semibold text-brand hover:text-brand-hover">
          <span aria-hidden="true">←</span> {dict.article.backToFeed}
        </Link>
      </nav>
    </Container>
  )
}
