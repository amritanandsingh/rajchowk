import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { getDictionary } from '@/lib/i18n'
import { LabeledBlock } from './labeled-block'

/**
 * The labelled editorial section.
 *
 * The product's central claim is that verified fact and personal opinion are
 * never visually indistinguishable, and this component states the boundary four
 * independent ways: a visible heading, a badge with text, a tone border and a
 * tinted background. The tests assert the ones that survive losing CSS.
 */

const dict = getDictionary('hi')

describe('LabeledBlock', () => {
  it('renders a landmark section wired to its own heading', () => {
    render(
      <LabeledBlock id="what-happened" title="क्या हुआ" badge="VERIFIED_FACT" tone="fact" dict={dict}>
        <p>सामग्री</p>
      </LabeledBlock>,
    )

    // aria-labelledby must resolve to a real element, or the landmark is
    // announced as unlabelled.
    const section = screen.getByRole('region', { name: 'क्या हुआ' })
    expect(section).toBeInTheDocument()
    expect(section.id).toBe('what-happened')

    const labelledBy = section.getAttribute('aria-labelledby')
    expect(labelledBy).toBe('what-happened-heading')
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('क्या हुआ')
  })

  it('renders the badge alongside the heading', () => {
    render(
      <LabeledBlock id="b" title="मेरा निष्कर्ष" badge="OPINION" tone="opinion" dict={dict}>
        <p>x</p>
      </LabeledBlock>,
    )
    expect(screen.getByText('मेरा निष्कर्ष')).toBeInTheDocument()
    expect(screen.getByText(dict.badge.opinion)).toBeInTheDocument()
  })

  it('renders its children', () => {
    render(
      <LabeledBlock id="b" title="t" badge="OPINION" tone="opinion" dict={dict}>
        <p>यह सामग्री है</p>
      </LabeledBlock>,
    )
    expect(screen.getByText('यह सामग्री है')).toBeInTheDocument()
  })

  it('defaults to h2 and honours an explicit h3', () => {
    const { unmount } = render(
      <LabeledBlock id="b" title="शीर्षक" badge="OPINION" tone="opinion" dict={dict}>
        <p>x</p>
      </LabeledBlock>,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'शीर्षक' })).toBeInTheDocument()
    unmount()

    render(
      <LabeledBlock
        id="b"
        title="शीर्षक"
        badge="OPINION"
        tone="opinion"
        dict={dict}
        headingLevel={3}
      >
        <p>x</p>
      </LabeledBlock>,
    )
    expect(screen.getByRole('heading', { level: 3, name: 'शीर्षक' })).toBeInTheDocument()
  })

  it.each([
    ['fact', 'tone-fact'],
    ['analysis', 'tone-analysis'],
    ['opinion', 'tone-opinion'],
    ['correction', 'tone-correction'],
  ] as const)('applies the %s tone as border AND background', (tone, token) => {
    const { container } = render(
      <LabeledBlock id="b" title="t" badge="OPINION" tone={tone} dict={dict}>
        <p>x</p>
      </LabeledBlock>,
    )
    const section = container.querySelector('section') as HTMLElement

    // Two independent visual signals, so one failing to load is not fatal.
    expect(section.className).toContain(`border-s-${token}`)
    expect(section.className).toContain(`bg-${token}-bg`)
  })

  it('keeps fact and opinion visually distinct', () => {
    const fact = render(
      <LabeledBlock id="f" title="t" badge="VERIFIED_FACT" tone="fact" dict={dict}>
        <p>x</p>
      </LabeledBlock>,
    )
    const factClass = (fact.container.querySelector('section') as HTMLElement).className
    fact.unmount()

    const opinion = render(
      <LabeledBlock id="o" title="t" badge="OPINION" tone="opinion" dict={dict}>
        <p>x</p>
      </LabeledBlock>,
    )
    const opinionClass = (opinion.container.querySelector('section') as HTMLElement).className

    expect(factClass).not.toBe(opinionClass)
  })

  it('still distinguishes the blocks with no CSS at all', () => {
    // The badge text is the signal that survives a stylesheet failure.
    const fact = render(
      <LabeledBlock id="f" title="क्या हुआ" badge="VERIFIED_FACT" tone="fact" dict={dict}>
        <p>x</p>
      </LabeledBlock>,
    )
    expect(fact.container.textContent).toContain(dict.badge.verifiedFact)
    fact.unmount()

    const opinion = render(
      <LabeledBlock id="o" title="मेरा निष्कर्ष" badge="OPINION" tone="opinion" dict={dict}>
        <p>x</p>
      </LabeledBlock>,
    )
    expect(opinion.container.textContent).toContain(dict.badge.opinion)
  })

  it('offsets scroll so a deep link does not land under the sticky header', () => {
    const { container } = render(
      <LabeledBlock id="my-analysis" title="t" badge="MY_ANALYSIS" tone="analysis" dict={dict}>
        <p>x</p>
      </LabeledBlock>,
    )
    expect((container.querySelector('section') as HTMLElement).className).toContain('scroll-mt-20')
  })
})
