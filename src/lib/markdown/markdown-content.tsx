import Link from 'next/link'
import { createElement, type ComponentPropsWithoutRef } from 'react'
import Markdown, { type Components } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'

import { env } from '@/lib/env'
import { isExternalHref, safeHref } from './safe-href'
import { articleSchema } from './sanitize-schema'

/**
 * The one place article Markdown becomes DOM.
 *
 * `react-markdown` renders to a React element tree and NEVER produces an HTML
 * string, so `dangerouslySetInnerHTML` appears nowhere on this path. That is a
 * structural property rather than a discipline: the ESLint config bans the
 * attribute outright, and `rehype-raw` — the plugin that would re-enable inline
 * HTML inside Markdown — is banned as an import.
 *
 * This is a Server Component, so on public pages none of the Markdown
 * machinery ships to the browser at all. The article page renders as static
 * HTML with no client-side parser.
 */
export function MarkdownContent({ source }: { source: string }) {
  if (!source?.trim()) return null

  return (
    <Markdown
      rehypePlugins={[[rehypeSanitize, articleSchema]]}
      components={MARKDOWN_COMPONENTS}
      // Belt and braces: drop any raw HTML node the parser produced, even
      // though rehype-raw is absent so none should exist.
      skipHtml
    >
      {source}
    </Markdown>
  )
}

/**
 * Sizes for article subheadings.
 *
 * These have to be explicit. Tailwind's preflight resets every h1–h6 to
 * `font-size: inherit`, and globals.css restores weight and line-height but
 * not size — so a heading with no `text-*` class inherits 1rem from `body`
 * while the paragraphs around it are `text-article` (1.125rem). Without this,
 * article subheadings render SMALLER than the body copy they introduce, and
 * `##`, `###` and `####` are visually identical to one another.
 *
 * `mt` is larger than `mb` on purpose: a subheading belongs to the section it
 * opens, so it sits closer to the text below it than to the text above.
 */
const HEADING_CLASS: Record<number, string> = {
  2: 'mt-10 mb-3 font-display text-2xl font-bold sm:text-3xl',
  3: 'mt-8 mb-3 font-display text-xl font-bold sm:text-2xl',
  4: 'mt-6 mb-2 font-display text-lg font-bold',
}

function heading(level: number) {
  return function Heading({ children, id }: ComponentPropsWithoutRef<'h2'>) {
    return createElement(
      `h${level}`,
      { id, className: `scroll-mt-20 text-balance ${HEADING_CLASS[level] ?? HEADING_CLASS[4]}` },
      children,
    )
  }
}

/**
 * Module-scoped rather than rebuilt per render.
 *
 * `react-markdown` treats a new `components` object as a reason to re-render
 * the whole tree, so constructing it inside the component would defeat
 * memoisation on every parent update for no benefit — nothing here closes over
 * a prop.
 */
const MARKDOWN_COMPONENTS: Components = {
  a({ href, children }) {
    const safe = safeHref(href, env.NEXT_PUBLIC_SITE_URL)
    // An unsafe href renders as plain text. Never fall back to the raw value —
    // that would reinstate precisely what was just rejected.
    if (!safe) return <>{children}</>

    if (isExternalHref(safe, env.NEXT_PUBLIC_SITE_URL)) {
      return (
        <a
          href={safe}
          target="_blank"
          // `noopener` closes the reverse-tabnabbing hole; `nofollow ugc`
          // because article links are authored copy and should not pass
          // authority automatically.
          rel="noopener noreferrer nofollow ugc"
          className="text-brand underline hover:text-brand-hover"
        >
          {children}
        </a>
      )
    }

    return (
      <Link href={safe} className="text-brand underline hover:text-brand-hover">
        {children}
      </Link>
    )
  },

  h2: heading(2),
  h3: heading(3),
  h4: heading(4),

  p({ children }) {
    return <p className="my-4 text-article">{children}</p>
  },

  ul({ children }) {
    return <ul className="my-4 list-disc space-y-2 ps-6 text-article">{children}</ul>
  },
  ol({ children }) {
    return <ol className="my-4 list-decimal space-y-2 ps-6 text-article">{children}</ol>
  },

  blockquote({ children }) {
    return (
      <blockquote className="my-6 border-s-4 border-brand-subtle ps-4 text-article text-fg-muted italic">
        {children}
      </blockquote>
    )
  },

  code({ className, children }) {
    // Fenced blocks arrive carrying a `language-` class; inline code does not.
    if (!className) {
      return <code className="rounded bg-bg-subtle px-1.5 py-0.5 text-[0.9em]">{children}</code>
    }
    return <code className={className}>{children}</code>
  },

  pre({ children }) {
    // A scroll container needs tabIndex, or keyboard users cannot reach it
    // when it holds no focusable child (WCAG 2.1.1).
    return (
      <pre tabIndex={0} className="my-4 overflow-x-auto rounded-card bg-bg-subtle p-4 text-sm">
        {children}
      </pre>
    )
  },

  hr() {
    return <hr className="my-8 border-border" />
  },
}
