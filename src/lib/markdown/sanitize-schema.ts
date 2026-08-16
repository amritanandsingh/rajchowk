import { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize'

/**
 * The XSS boundary.
 *
 * This runs on the hast tree AFTER parsing and BEFORE React sees it, so it is
 * a structural allowlist rather than a string-regex exercise — the thing being
 * filtered is a parsed element tree, not text that might parse differently
 * later.
 *
 * Three properties make it a real boundary rather than a speed bump:
 *
 *  - `rehype-raw` is never installed, and is banned by an ESLint
 *    `no-restricted-imports` rule. Without it, raw HTML written into the
 *    Markdown source is parsed as literal text and rendered as escaped text
 *    nodes — a `<script>` in an article body is characters on a page.
 *  - `react-markdown` renders to a React element tree and never produces an
 *    HTML string, so there is no `dangerouslySetInnerHTML` anywhere on the
 *    content path. ESLint bans that attribute outright too.
 *  - The allowlist below is a closed set. An element not named here is dropped,
 *    so the safe default is "removed" rather than "permitted unless known bad".
 *
 * Worth being honest about the threat model: article content is authored by
 * administrators, who are trusted people. This is defence against a compromised
 * admin account and against paste-from-anywhere accidents, not against the
 * general public — but an admin account is precisely the one worth defending,
 * because content it writes is served to every reader.
 */
export const articleSchema: SanitizeOptions = {
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
    // h1 is the page title, so article content starts at h2. Allowing h1 here
    // would let an article body put a second top-level heading in the
    // document outline.
    'h2',
    'h3',
    'h4',
    'a',
    'code',
    'pre',
    'hr',
    // Images are uploaded by an administrator and inserted as Markdown
    // `![alt](url)`. Allowing the tag is only one third of what that needs —
    // see `attributes.img` and `protocols.src` below. All three go together.
    'img',
  ],
  attributes: {
    a: ['href', 'title'],
    // Language classes only, for syntax highlighting hooks. The pattern is
    // what stops an author reaching an arbitrary application style.
    code: [['className', /^language-[a-z0-9+-]+$/]],
    /**
     * `src`, `alt` and `title`, and nothing else.
     *
     * No `width`/`height` (a Markdown image cannot express them anyway), no
     * `srcset`, and emphatically no `on*` — those are already excluded by the
     * `'*': []` catch-all below, and this list does not re-admit them.
     */
    img: ['src', 'alt', 'title'],
    // Nothing else, on any element. This line is what removes every `on*`
    // handler, `style`, and `id` in one go.
    '*': [],
  },
  /**
   * NOTE THE SHAPE: this object REPLACES `defaultSchema.protocols` wholesale,
   * it does not merge with it. Every attribute whose protocol matters must
   * therefore be listed here, including ones the default already covered.
   *
   * That is why `src` is present. Omitting it does not fall back to the
   * default `src: ['http','https']` — it means `src` has NO protocol
   * allowlist at all, and `![x](javascript:…)` reaches the DOM. The omission
   * was harmless while `img` was disallowed and `'*': []` stripped every
   * `src`; it stopped being harmless the moment images were permitted above.
   */
  protocols: {
    // No `javascript:`, no `data:`. safe-href.ts checks this again at render
    // time; the two are independent and both must pass.
    href: ['http', 'https', 'mailto'],
    // Same rule for images, minus `mailto:`. safe-src.ts is the second check.
    src: ['http', 'https'],
  },
  // Prefixes any generated id so a heading anchor cannot collide with — or
  // clobber — an id the application itself relies on.
  clobberPrefix: 'md-',
  ancestors: {
    ...defaultSchema.ancestors,
    li: ['ul', 'ol'],
  },
}
