import type { Root } from 'mdast'
import { visit } from 'unist-util-visit'
import { parseYouTubeId } from '@/lib/domain/youtube'

/**
 * Turns `::youtube{id=…}`, `::figure{…}` and `::callout{…}` directives into
 * plain `div`s carrying validated data attributes.
 *
 * Editors get rich embeds without raw HTML ever being allowed anywhere in the
 * pipeline. Every value is validated HERE, before the sanitizer runs, and a
 * directive that fails validation is DROPPED rather than partially rendered —
 * a half-configured embed is a bug report; a permissively rendered one is a
 * vulnerability.
 */

type DirectiveNode = {
  type: string
  name?: string
  attributes?: Record<string, string | null | undefined>
  data?: { hName?: string; hProperties?: Record<string, unknown> }
  children?: unknown[]
}

/** Only our own media origins may be embedded as an image. */
function isAllowedMediaSrc(src: string): boolean {
  try {
    const url = new URL(src)
    if (url.protocol !== 'https:') return false

    const cdnHost = process.env.NEXT_PUBLIC_MEDIA_CDN_HOST
    if (cdnHost && url.hostname === cdnHost) return true

    // Amplify Storage's S3 origins.
    return url.hostname.endsWith('.amazonaws.com') && url.pathname.startsWith('/media/')
  } catch {
    return false
  }
}

const CALLOUT_TONES = new Set(['note', 'warning', 'correction'])

/** Replaces a node with nothing, so an invalid directive disappears entirely. */
function drop(node: DirectiveNode): void {
  node.type = 'text'
  node.data = {}
  ;(node as unknown as { value: string }).value = ''
  node.children = []
}

export function remarkDirectiveToData() {
  return (tree: Root): void => {
    visit(tree, (node: unknown) => {
      const directive = node as DirectiveNode
      if (
        directive.type !== 'containerDirective' &&
        directive.type !== 'leafDirective' &&
        directive.type !== 'textDirective'
      ) {
        return
      }

      const attributes = directive.attributes ?? {}

      switch (directive.name) {
        case 'youtube': {
          // Accept a bare id or a pasted URL, but store only the 11-char id.
          const id = parseYouTubeId(attributes.id ?? attributes.url ?? '')
          if (!id) {
            drop(directive)
            return
          }
          directive.data = {
            hName: 'div',
            hProperties: {
              className: 'rc-embed',
              'data-directive': 'youtube',
              'data-video-id': id,
              'data-caption': (attributes.caption ?? '').slice(0, 200),
            },
          }
          directive.children = []
          return
        }

        case 'figure': {
          const src = attributes.src ?? ''
          if (!isAllowedMediaSrc(src)) {
            drop(directive)
            return
          }
          // Alt text is mandatory. The editor UI enforces it at insert time;
          // this is the backstop for hand-edited markdown.
          const alt = (attributes.alt ?? '').trim()
          if (!alt) {
            drop(directive)
            return
          }
          directive.data = {
            hName: 'div',
            hProperties: {
              className: 'rc-figure',
              'data-directive': 'figure',
              'data-src': src,
              'data-alt': alt.slice(0, 300),
              'data-caption': (attributes.caption ?? '').slice(0, 300),
            },
          }
          directive.children = []
          return
        }

        case 'callout': {
          const tone = attributes.tone ?? 'note'
          directive.data = {
            hName: 'div',
            hProperties: {
              className: 'rc-callout',
              'data-tone': CALLOUT_TONES.has(tone) ? tone : 'note',
            },
          }
          return
        }

        default:
          // An unknown directive renders as nothing rather than leaking its
          // raw source into the page.
          drop(directive)
      }
    })
  }
}
