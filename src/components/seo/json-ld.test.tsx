import { render } from '@testing-library/react'
import type { WithContext, Thing } from 'schema-dts'
import { describe, expect, it } from 'vitest'
import { JsonLd } from './json-ld'

/**
 * JSON-LD emission.
 *
 * This is one of only two sanctioned uses of dangerouslySetInnerHTML in the
 * codebase, so its single security property gets pinned down here: every `<` is
 * escaped, because `JSON.stringify` alone does NOT stop a `</script>` sequence
 * inside a string value from closing the tag early.
 */

const script = (container: HTMLElement) =>
  container.querySelector('script[type="application/ld+json"]')

describe('JsonLd', () => {
  it('emits a single ld+json script for one object', () => {
    const { container } = render(
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'Thing', name: 'x' } as WithContext<Thing>} />,
    )
    const scripts = container.querySelectorAll('script[type="application/ld+json"]')
    expect(scripts).toHaveLength(1)
    expect(JSON.parse(scripts[0]!.textContent ?? '{}')).toMatchObject({ name: 'x' })
  })

  it('emits one script per entry for an array', () => {
    const { container } = render(
      <JsonLd
        data={[
          { '@context': 'https://schema.org', '@type': 'Thing', name: 'a' },
          { '@context': 'https://schema.org', '@type': 'Thing', name: 'b' },
        ] as WithContext<Thing>[]}
      />,
    )
    expect(container.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(2)
  })

  it('escapes < so a payload cannot close the script tag early', () => {
    // The attack: a headline containing "</script><img onerror=...>" would
    // otherwise terminate the JSON-LD block and inject markup into the page.
    const { container } = render(
      <JsonLd
        data={
          {
            '@context': 'https://schema.org',
            '@type': 'Thing',
            name: '</script><img src=x onerror=alert(1)>',
          } as WithContext<Thing>
        }
      />,
    )

    const html = script(container)?.innerHTML ?? ''
    expect(html).not.toContain('</script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('\\u003c')
  })

  it('escapes every < , not just the first', () => {
    const name = '<<<a<b<c'
    const { container } = render(
      <JsonLd
        data={{ '@context': 'https://schema.org', '@type': 'Thing', name } as WithContext<Thing>}
      />,
    )
    const html = script(container)?.innerHTML ?? ''

    // No unescaped '<' survives anywhere.
    expect(html).not.toMatch(/(?<!\\u003)</)
    // Derive the expected count from the input rather than hard-coding it.
    const expected = (name.match(/</g) ?? []).length
    expect((html.match(/\\u003c/g) ?? []).length).toBe(expected)
  })

  it('stays valid JSON after escaping', () => {
    // The escape must be inside a JSON string literal, so the payload still
    // parses — and round-trips back to the original text.
    const name = '</script> तथा <b>बोल्ड</b>'
    const { container } = render(
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'Thing', name } as WithContext<Thing>} />,
    )
    const parsed = JSON.parse(script(container)?.textContent ?? '{}')
    expect(parsed.name).toBe(name)
  })

  it('preserves Devanagari without escaping it', () => {
    const { container } = render(
      <JsonLd
        data={
          { '@context': 'https://schema.org', '@type': 'Thing', name: 'दिल्ली में फैसला' } as WithContext<Thing>
        }
      />,
    )
    expect(JSON.parse(script(container)?.textContent ?? '{}').name).toBe('दिल्ली में फैसला')
  })

  it('renders nothing for an empty array', () => {
    const { container } = render(<JsonLd data={[]} />)
    expect(container.querySelectorAll('script')).toHaveLength(0)
  })

  it('does not use next/script, which crawlers can miss', () => {
    // next/script defers and relocates the tag; a plain <script> in the markup
    // is what Google actually reads.
    const { container } = render(
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'Thing' } as WithContext<Thing>} />,
    )
    const element = script(container)
    expect(element?.tagName).toBe('SCRIPT')
    expect(element?.getAttribute('src')).toBeNull()
    expect(element?.hasAttribute('defer')).toBe(false)
    expect(element?.hasAttribute('async')).toBe(false)
  })
})
