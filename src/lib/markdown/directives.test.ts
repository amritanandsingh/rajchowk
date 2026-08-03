import type { Root } from 'mdast'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { remarkDirectiveToData } from './directives'

/**
 * The directive validator.
 *
 * Editors write `::youtube{...}` / `::figure{...}` / `::callout{...}` instead of
 * raw HTML. Everything is validated HERE, before the sanitizer runs, and the
 * governing rule is that an invalid directive is DROPPED rather than partially
 * rendered — a half-configured embed is a bug report; a permissively rendered
 * one is a vulnerability.
 */

const VALID_ID = 'dQw4w9WgXcQ'
const MEDIA_HOST = 'media.rajchowk.in'

type DirectiveNode = {
  type: string
  name?: string
  attributes?: Record<string, string>
  data?: { hName?: string; hProperties?: Record<string, unknown> }
  children?: unknown[]
  value?: string
}

/** Minimal mdast tree holding one directive node. */
function treeWith(node: DirectiveNode): { tree: Root; node: DirectiveNode } {
  const tree = { type: 'root', children: [node] } as unknown as Root
  return { tree, node }
}

function leaf(name: string, attributes: Record<string, string>): DirectiveNode {
  return { type: 'leafDirective', name, attributes, children: [] }
}

function transform(node: DirectiveNode): DirectiveNode {
  const { tree } = treeWith(node)
  remarkDirectiveToData()(tree)
  return node
}

/** A dropped directive becomes an empty text node. */
function wasDropped(node: DirectiveNode): boolean {
  return node.type === 'text' && node.value === '' && !node.data?.hName
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_MEDIA_CDN_HOST', MEDIA_HOST)
})

describe('::youtube', () => {
  it('accepts a bare 11-character id', () => {
    const node = transform(leaf('youtube', { id: VALID_ID }))
    expect(node.data?.hName).toBe('div')
    expect(node.data?.hProperties).toMatchObject({
      className: 'rc-embed',
      'data-directive': 'youtube',
      'data-video-id': VALID_ID,
    })
  })

  it('reduces a pasted watch URL to the bare id', () => {
    const node = transform(leaf('youtube', { id: `https://www.youtube.com/watch?v=${VALID_ID}` }))
    expect(node.data?.hProperties?.['data-video-id']).toBe(VALID_ID)
  })

  it('accepts the url attribute as an alias', () => {
    const node = transform(leaf('youtube', { url: `https://youtu.be/${VALID_ID}` }))
    expect(node.data?.hProperties?.['data-video-id']).toBe(VALID_ID)
  })

  it('DROPS a directive whose id is invalid', () => {
    // Never partially render: no id means no embed at all.
    expect(wasDropped(transform(leaf('youtube', { id: 'too-short' })))).toBe(true)
    expect(wasDropped(transform(leaf('youtube', {})))).toBe(true)
    expect(wasDropped(transform(leaf('youtube', { id: '' })))).toBe(true)
  })

  it('DROPS a directive pointing at a non-YouTube host', () => {
    expect(wasDropped(transform(leaf('youtube', { url: `https://evil.com/watch?v=${VALID_ID}` })))).toBe(
      true,
    )
    // A look-alike host must not slip through.
    expect(
      wasDropped(transform(leaf('youtube', { url: `https://youtube.com.evil.com/watch?v=${VALID_ID}` }))),
    ).toBe(true)
  })

  it('DROPS a javascript: payload', () => {
    expect(wasDropped(transform(leaf('youtube', { url: 'javascript:alert(1)' })))).toBe(true)
  })

  it('truncates a very long caption', () => {
    const node = transform(leaf('youtube', { id: VALID_ID, caption: 'क'.repeat(500) }))
    expect(String(node.data?.hProperties?.['data-caption']).length).toBeLessThanOrEqual(200)
  })

  it('emits no children, so nothing can be smuggled inside the embed', () => {
    const node = transform({
      type: 'containerDirective',
      name: 'youtube',
      attributes: { id: VALID_ID },
      children: [{ type: 'text', value: 'smuggled' }],
    })
    expect(node.children).toEqual([])
  })
})

describe('::figure', () => {
  const src = `https://${MEDIA_HOST}/media/articles/hero/x.jpg`

  it('accepts an image on our own media host with alt text', () => {
    const node = transform(leaf('figure', { src, alt: 'एक तस्वीर' }))
    expect(node.data?.hProperties).toMatchObject({
      className: 'rc-figure',
      'data-src': src,
      'data-alt': 'एक तस्वीर',
    })
  })

  it('accepts an Amplify S3 media path', () => {
    const s3 = 'https://bucket.s3.ap-south-1.amazonaws.com/media/articles/hero/x.jpg'
    const node = transform(leaf('figure', { src: s3, alt: 'तस्वीर' }))
    expect(node.data?.hProperties?.['data-src']).toBe(s3)
  })

  it('DROPS an image from any other origin', () => {
    // Otherwise an editor could hotlink — or beacon — an arbitrary third party.
    expect(wasDropped(transform(leaf('figure', { src: 'https://evil.com/x.jpg', alt: 'a' })))).toBe(
      true,
    )
  })

  it('DROPS a non-https image', () => {
    expect(
      wasDropped(transform(leaf('figure', { src: `http://${MEDIA_HOST}/media/x.jpg`, alt: 'a' }))),
    ).toBe(true)
  })

  it('DROPS an image with no alt text — accessibility is a hard gate', () => {
    expect(wasDropped(transform(leaf('figure', { src })))).toBe(true)
    expect(wasDropped(transform(leaf('figure', { src, alt: '   ' })))).toBe(true)
  })

  it('DROPS a data: or javascript: src', () => {
    expect(wasDropped(transform(leaf('figure', { src: 'data:image/svg+xml,<svg/>', alt: 'a' })))).toBe(
      true,
    )
    expect(wasDropped(transform(leaf('figure', { src: 'javascript:alert(1)', alt: 'a' })))).toBe(true)
  })
})

describe('::callout', () => {
  it('accepts the allow-listed tones', () => {
    for (const tone of ['note', 'warning', 'correction']) {
      const node = transform({
        type: 'containerDirective',
        name: 'callout',
        attributes: { tone },
        children: [],
      })
      expect(node.data?.hProperties?.['data-tone']).toBe(tone)
    }
  })

  it('falls back to note for an unknown tone rather than passing it through', () => {
    const node = transform({
      type: 'containerDirective',
      name: 'callout',
      attributes: { tone: 'evil' },
      children: [],
    })
    expect(node.data?.hProperties?.['data-tone']).toBe('note')
  })

  it('defaults to note when no tone is given', () => {
    const node = transform({
      type: 'containerDirective',
      name: 'callout',
      attributes: {},
      children: [],
    })
    expect(node.data?.hProperties?.['data-tone']).toBe('note')
  })

  it('keeps its children, unlike the leaf directives', () => {
    const node = transform({
      type: 'containerDirective',
      name: 'callout',
      attributes: { tone: 'note' },
      children: [{ type: 'paragraph', children: [] }],
    })
    expect(node.children).toHaveLength(1)
  })
})

describe('unknown directives', () => {
  it('DROPS an unrecognised directive rather than leaking its source', () => {
    expect(wasDropped(transform(leaf('script', { src: 'https://evil.com/x.js' })))).toBe(true)
    expect(wasDropped(transform(leaf('iframe', { src: 'https://evil.com' })))).toBe(true)
    expect(wasDropped(transform(leaf('anything', {})))).toBe(true)
  })

  it('leaves non-directive nodes untouched', () => {
    const paragraph = { type: 'paragraph', children: [{ type: 'text', value: 'सादा पाठ' }] }
    const tree = { type: 'root', children: [paragraph] } as unknown as Root
    remarkDirectiveToData()(tree)
    expect(paragraph.type).toBe('paragraph')
    expect(paragraph.children).toHaveLength(1)
  })
})
