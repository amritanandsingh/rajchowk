import Link from 'next/link'
import { createElement, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkDirective from 'remark-directive'
import remarkGfm from 'remark-gfm'
import { YouTubeEmbed } from '@/components/editorial/youtube-embed'
import { env } from '@/lib/env'
import { remarkDirectiveToData } from './directives'
import { isExternalHref, safeHref } from './safe-href'
import { schemaFull, schemaInline } from './sanitize-schema'
import { MarkdownFigure } from './markdown-figure'

/**
 * The one place article Markdown becomes DOM.
 *
 * `react-markdown` renders to a React element tree and NEVER produces an HTML
 * string, so `dangerouslySetInnerHTML` appears nowhere on this path. That is a
 * structural property, not a discipline: the ESLint config bans the attribute
 * outright, and `rehype-raw` — the plugin that would re-enable inline HTML in
 * Markdown — is banned as an import.
 *
 * This is a Server Component, so on public pages none of the markdown
 * machinery ships to the browser at all.
 */

type Profile = 'full' | 'inline'

export function MarkdownContent({
  source,
  profile = 'full',
  headingOffset = 0,
}: {
  source: string
  profile?: Profile
  /** Pushes h2 to h3 etc., so blocks nested inside a labelled section keep the
   *  document outline legal. */
  headingOffset?: number
}) {
  if (!source?.trim()) return null

  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkDirective, remarkDirectiveToData]}
      rehypePlugins={[[rehypeSanitize, profile === 'full' ? schemaFull : schemaInline]]}
      components={markdownComponents(headingOffset)}
      // Belt and braces: drop any raw HTML node the parser produced, even
      // though rehype-raw is absent so none should exist.
      skipHtml
    >
      {source}
    </Markdown>
  )
}

/**
 * Sizes for article subheadings, by the level the EDITOR wrote.
 *
 * These have to be explicit. Tailwind's preflight resets every h1–h6 to
 * `font-size: inherit`, and globals.css restores weight and line-height but not
 * size — so a heading with no `text-*` class inherits 1rem from `body` while the
 * paragraphs around it are `text-article` (1.125rem). Article subheadings were
 * therefore rendering SMALLER than the body copy they introduce, and `##`,
 * `###` and `####` were visually identical to each other.
 *
 * Keyed by the authored level rather than the rendered one, so the visual
 * hierarchy an editor writes is what they get regardless of `headingOffset` —
 * that prop exists to keep the document outline valid when the article body is
 * nested under an h1, not to shrink the text.
 *
 * `mt` is larger than `mb` on purpose: a subheading belongs to the section it
 * opens, so it should sit closer to the text below it than to the text above.
 */
const HEADING_CLASS: Record<number, string> = {
  2: 'mt-10 mb-3 font-display text-2xl font-bold sm:text-3xl',
  3: 'mt-8 mb-3 font-display text-xl font-bold sm:text-2xl',
  4: 'mt-6 mb-2 font-display text-lg font-bold',
}

function markdownComponents(headingOffset: number): Components {
  const heading = (level: number) =>
    function Heading({ children, id }: ComponentPropsWithoutRef<'h2'>) {
      const clamped = Math.min(level + headingOffset, 6)
      return createElement(
        `h${clamped}`,
        { id, className: `scroll-mt-20 text-balance ${HEADING_CLASS[level] ?? HEADING_CLASS[4]}` },
        children,
      )
    }

  return {
    a({ href, children }) {
      const safe = safeHref(href, env.NEXT_PUBLIC_SITE_URL)
      // An unsafe href renders as plain text. Never fall back to the raw value.
      if (!safe) return <>{children}</>

      if (isExternalHref(safe, env.NEXT_PUBLIC_SITE_URL)) {
        return (
          <a
            href={safe}
            target="_blank"
            // `ugc` and `nofollow` because article links are editor-authored
            // and we do not want to pass authority automatically.
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
      return <p className="my-4 text-article leading-relaxed">{children}</p>
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
      // Fenced blocks arrive with a language- class; inline code does not.
      if (!className) {
        return <code className="rounded bg-bg-subtle px-1.5 py-0.5 text-[0.9em]">{children}</code>
      }
      return <code className={className}>{children}</code>
    },

    pre({ children }) {
      return (
        <pre className="my-4 overflow-x-auto rounded-card bg-bg-subtle p-4 text-sm">{children}</pre>
      )
    },

    table({ children }) {
      // A scroll container needs tabIndex, or keyboard users cannot reach it
      // when it holds no focusable child (WCAG 2.1.1).
      return (
        <div
          role="region"
          aria-label="तालिका"
          tabIndex={0}
          className="my-6 overflow-x-auto rounded-card border border-border"
        >
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      )
    },
    th({ children }) {
      return (
        <th
          scope="col"
          className="border-b border-border bg-bg-subtle p-3 text-start font-semibold"
        >
          {children}
        </th>
      )
    },
    td({ children }) {
      return <td className="border-b border-border p-3 align-top">{children}</td>
    },

    hr() {
      return <hr className="my-8 border-border" />
    },

    // Directive output. Anything that reaches here has already been validated
    // by remarkDirectiveToData and survived the sanitizer's className allowlist.
    div(rawProps) {
      // react-markdown does not type data-* attributes, so narrow once here
      // rather than indexing an untyped record at every use site.
      const props = rawProps as { className?: string; children?: ReactNode } & Record<
        string,
        unknown
      >
      const { className, children } = props

      if (className === 'rc-embed' && props['data-directive'] === 'youtube') {
        const videoId = String(props['data-video-id'] ?? '')
        const caption = String(props['data-caption'] ?? '')
        if (!videoId) return null
        return <YouTubeEmbed videoId={videoId} {...(caption ? { caption } : {})} />
      }

      if (className === 'rc-figure') {
        return (
          <MarkdownFigure
            src={String(props['data-src'] ?? '')}
            alt={String(props['data-alt'] ?? '')}
            caption={String(props['data-caption'] ?? '')}
          />
        )
      }

      if (className === 'rc-callout') {
        const tone = String(props['data-tone'] ?? 'note')
        const toneClass =
          tone === 'correction'
            ? 'border-tone-correction bg-tone-correction-bg'
            : tone === 'warning'
              ? 'border-tone-developing bg-tone-developing-bg'
              : 'border-tone-analysis bg-tone-analysis-bg'
        return <div className={`my-6 rounded-card border-s-4 p-4 ${toneClass}`}>{children}</div>
      }

      return <div className={className}>{children}</div>
    },
  }
}
