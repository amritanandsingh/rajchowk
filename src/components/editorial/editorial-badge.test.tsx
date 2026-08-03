import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { getDictionary } from '@/lib/i18n'
import { EditorialBadge, type EditorialBadgeKind } from './editorial-badge'

/**
 * The badge that tells a reader what KIND of claim they are looking at.
 *
 * This is the product's core credibility mechanism, so the tests assert on TEXT
 * and structure, never on a colour class. The governing property: remove all
 * colour and no information is lost.
 */

const dict = getDictionary('hi')

const ALL_KINDS: EditorialBadgeKind[] = [
  'VERIFIED_FACT',
  'MY_ANALYSIS',
  'OPINION',
  'DEVELOPING',
  'CORRECTION',
  'SPONSORED',
]

describe('EditorialBadge', () => {
  it.each(ALL_KINDS)('renders a visible text label for %s', (kind) => {
    const { container } = render(<EditorialBadge kind={kind} dict={dict} />)

    // Text, not colour. This is what survives greyscale printing, reader mode
    // and colour-blindness.
    expect(container.textContent?.trim()).toBeTruthy()
    expect(container.textContent?.trim().length).toBeGreaterThan(1)
  })

  it('uses the dictionary label for each kind', () => {
    const expected: Record<EditorialBadgeKind, string> = {
      VERIFIED_FACT: dict.badge.verifiedFact,
      MY_ANALYSIS: dict.badge.myAnalysis,
      OPINION: dict.badge.opinion,
      DEVELOPING: dict.badge.developing,
      CORRECTION: dict.badge.correction,
      SPONSORED: dict.badge.sponsored,
    }

    for (const kind of ALL_KINDS) {
      const { unmount } = render(<EditorialBadge kind={kind} dict={dict} />)
      expect(screen.getByText(expected[kind]), kind).toBeInTheDocument()
      unmount()
    }
  })

  it('gives every kind a DISTINCT label, so none is ambiguous', () => {
    const labels = ALL_KINDS.map((kind) => {
      const { container, unmount } = render(<EditorialBadge kind={kind} dict={dict} />)
      const text = container.textContent?.trim() ?? ''
      unmount()
      return text
    })
    expect(new Set(labels).size).toBe(ALL_KINDS.length)
  })

  it.each(ALL_KINDS)('renders an icon for %s, hidden from assistive tech', (kind) => {
    // The icon is redundant reinforcement for sighted users; the label already
    // carries the meaning, so the icon must not be announced twice.
    const { container } = render(<EditorialBadge kind={kind} dict={dict} />)
    const icon = container.querySelector('svg')

    expect(icon, kind).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
  })

  it('gives every kind a DISTINCT icon', () => {
    const paths = ALL_KINDS.map((kind) => {
      const { container, unmount } = render(<EditorialBadge kind={kind} dict={dict} />)
      const markup = container.querySelector('svg')?.innerHTML ?? ''
      unmount()
      return markup
    })
    expect(new Set(paths).size).toBe(ALL_KINDS.length)
  })

  it('renders the English label when given the English dictionary', () => {
    render(<EditorialBadge kind="VERIFIED_FACT" dict={getDictionary('en')} />)
    expect(screen.getByText('Verified Fact')).toBeInTheDocument()
  })

  it('accepts an extra className without dropping its own styling', () => {
    const { container } = render(
      <EditorialBadge kind="OPINION" dict={dict} className="mt-4" />,
    )
    const badge = container.firstElementChild as HTMLElement
    expect(badge.className).toContain('mt-4')
    expect(badge.className).toContain('rounded-full')
  })

  it('survives losing all colour — the greyscale test', () => {
    // Strip every colour-bearing class and check the meaning is still there.
    const { container } = render(<EditorialBadge kind="OPINION" dict={dict} />)
    const badge = container.firstElementChild as HTMLElement

    badge.className = badge.className
      .split(' ')
      .filter((cls) => !/^(text|bg|border)-/.test(cls))
      .join(' ')

    expect(badge.textContent).toContain(dict.badge.opinion)
    expect(badge.querySelector('svg')).not.toBeNull()
  })
})
