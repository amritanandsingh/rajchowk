import { defaultSchema } from 'hast-util-sanitize'
import type { Options as SanitizeOptions } from 'rehype-sanitize'

/**
 * The XSS boundary.
 *
 * This runs on the hast tree AFTER parsing and BEFORE React sees it, so it is
 * a structural allowlist rather than a string-regex exercise.
 *
 * Two things make it a real boundary rather than a speed bump:
 *  - `rehype-raw` is never installed, and is banned by an ESLint
 *    `no-restricted-imports` rule. Without it, raw HTML in the Markdown source
 *    is parsed as literal text and rendered as escaped text nodes.
 *  - `react-markdown` renders to a React element tree and never produces an
 *    HTML string, so there is no `dangerouslySetInnerHTML` anywhere on the
 *    content path.
 */

/** The full profile: the main article body and the analysis block. */
export const schemaFull: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [
    'p',
    'br',
    'strong',
    'em',
    'del',
    'blockquote',
    'ul',
    'ol',
    'li',
    // h1 is the page title, so article content starts at h2.
    'h2',
    'h3',
    'h4',
    'a',
    'code',
    'pre',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'sup',
    'sub',
    'img',
    'figure',
    'figcaption',
    'div',
    'span',
  ],
  attributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    code: [['className', /^language-[a-z0-9+-]+$/]],
    // Directive output only. The className pattern is what stops an author
    // reaching an arbitrary app style or an existing DOM id.
    div: [
      ['className', /^(rc-embed|rc-callout|rc-figure)$/],
      'data-directive',
      'data-video-id',
      'data-caption',
      'data-tone',
      'data-src',
      'data-alt',
    ],
    span: [['className', /^rc-[a-z-]+$/]],
    th: ['scope'],
    td: ['colspan', 'rowspan'],
    // Nothing else, on any element.
    '*': [],
  },
  protocols: {
    href: ['http', 'https', 'mailto'],
    // https only: an http image on an https page is a mixed-content warning.
    src: ['https'],
  },
  // Prefixes generated ids so heading anchors cannot collide with — or
  // clobber — an id the application itself relies on.
  clobberPrefix: 'md-',
  ancestors: {
    ...defaultSchema.ancestors,
    li: ['ul', 'ol'],
    td: ['tr'],
    th: ['tr'],
    figcaption: ['figure'],
  },
}

/**
 * The inline profile: key facts, the conclusion, and correction notices.
 *
 * No headings, images, tables or block quotes. These blocks are short by
 * editorial intent, and allowing a heading inside them would break the
 * document outline.
 */
export const schemaInline: SanitizeOptions = {
  ...schemaFull,
  tagNames: ['p', 'br', 'strong', 'em', 'del', 'a', 'code', 'sup', 'sub'],
}
