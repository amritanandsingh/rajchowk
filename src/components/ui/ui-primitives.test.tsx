import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'
import { SkipLink } from './skip-link'
import { VisuallyHidden } from './visually-hidden'

/**
 * UI primitives.
 *
 * The properties worth testing here are the accessibility ones, because they
 * are invisible in a screenshot and easy to regress: the 44px tap target, the
 * busy state, and a skip link that actually moves focus.
 */

describe('Button', () => {
  it('renders its label and is clickable', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>वोट दें</Button>)

    await userEvent.click(screen.getByRole('button', { name: 'वोट दें' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('always meets the 44px minimum tap target', () => {
    // WCAG 2.5.5. On the base class, so no variant can drop below it.
    for (const size of ['sm', 'md', 'lg', 'icon', 'full'] as const) {
      const { container, unmount } = render(<Button size={size}>x</Button>)
      expect((container.firstElementChild as HTMLElement).className, size).toContain('min-h-11')
      unmount()
    }
  })

  it('marks itself busy and disabled while loading', async () => {
    const onClick = vi.fn()
    render(
      <Button loading loadingLabel="भेजा जा रहा है" onClick={onClick}>
        भेजें
      </Button>,
    )

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()

    // A disabled button must not fire, or a double-submit slips through.
    await userEvent.click(button).catch(() => undefined)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps the label visible while loading, so the button does not resize', () => {
    render(<Button loading>भेजें</Button>)
    expect(screen.getByRole('button')).toHaveTextContent('भेजें')
  })

  it('announces the loading state to assistive tech when given a label', () => {
    render(
      <Button loading loadingLabel="भेजा जा रहा है">
        भेजें
      </Button>,
    )
    expect(screen.getByText('भेजा जा रहा है')).toHaveClass('sr-only')
  })

  it('omits aria-busy when not loading', () => {
    render(<Button>भेजें</Button>)
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy')
  })

  it('respects an explicit disabled prop', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        x
      </Button>,
    )
    expect(screen.getByRole('button')).toBeDisabled()
    await userEvent.click(screen.getByRole('button')).catch(() => undefined)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders a visible focus ring for keyboard users', () => {
    const { container } = render(<Button>x</Button>)
    expect((container.firstElementChild as HTMLElement).className).toContain('focus-visible:outline')
  })

  it('honours prefers-reduced-motion on its transition', () => {
    const { container } = render(<Button>x</Button>)
    expect((container.firstElementChild as HTMLElement).className).toContain(
      'motion-reduce:transition-none',
    )
  })

  it('is reachable by keyboard', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>x</Button>)

    await userEvent.tab()
    expect(screen.getByRole('button')).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalled()
  })
})

describe('SkipLink', () => {
  it('points at the target id', () => {
    render(<SkipLink targetId="content" label="मुख्य सामग्री पर जाएँ" />)
    expect(screen.getByRole('link', { name: 'मुख्य सामग्री पर जाएँ' })).toHaveAttribute(
      'href',
      '#content',
    )
  })

  it('is hidden until focused, then becomes visible', async () => {
    render(<SkipLink targetId="content" label="जाएँ" />)
    const link = screen.getByRole('link')

    // sr-only keeps it in the accessibility tree while hiding it visually —
    // display:none would remove it from the tree entirely.
    expect(link.className).toContain('sr-only')
    expect(link.className).toContain('focus:not-sr-only')

    await userEvent.tab()
    expect(link).toHaveFocus()
  })

  it('sits above the sticky header when focused', () => {
    // A skip link rendered behind the header looks broken to exactly the users
    // it exists for. Header is z-40.
    render(<SkipLink targetId="content" label="जाएँ" />)
    expect(screen.getByRole('link').className).toContain('focus:z-50')
  })

  it('is the first focusable element on the page', async () => {
    render(
      <>
        <SkipLink targetId="content" label="जाएँ" />
        <button type="button">कुछ और</button>
      </>,
    )
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'जाएँ' })).toHaveFocus()
  })
})

describe('VisuallyHidden', () => {
  it('stays in the accessibility tree while hidden visually', () => {
    render(<VisuallyHidden>नई विंडो में खुलता है</VisuallyHidden>)
    const element = screen.getByText('नई विंडो में खुलता है')
    expect(element).toBeInTheDocument()
    expect(element).toHaveClass('sr-only')
  })
})
