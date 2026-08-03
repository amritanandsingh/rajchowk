import { describe, expect, it } from 'vitest'
import { cn } from './cn'

/**
 * Class merging.
 *
 * The behaviour that matters is conflict resolution: a component's default
 * padding must lose to a caller's override, otherwise every `className` prop on
 * every component is silently ignored and the bug looks like a CSS problem.
 */

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('lets the LAST conflicting Tailwind utility win', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-sm', 'text-lg')).toBe('text-lg')
    expect(cn('bg-brand', 'bg-accent')).toBe('bg-accent')
  })

  it('keeps utilities that only look like they conflict', () => {
    // Different axes must both survive.
    expect(cn('px-2', 'py-4')).toBe('px-2 py-4')
    expect(cn('mt-2', 'mb-4')).toBe('mt-2 mb-4')
  })

  it('resolves conflicts across variants independently', () => {
    expect(cn('p-2', 'md:p-4')).toBe('p-2 md:p-4')
    expect(cn('md:p-2', 'md:p-4')).toBe('md:p-4')
    expect(cn('hover:bg-brand', 'hover:bg-accent')).toBe('hover:bg-accent')
  })

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b')
  })

  it('supports conditional object and array syntax', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active')
    expect(cn(['a', 'b'], 'c')).toBe('a b c')
  })

  it('returns an empty string for no input', () => {
    expect(cn()).toBe('')
    expect(cn(undefined)).toBe('')
  })

  it('lets a caller override a component default — the reason this exists', () => {
    const componentDefault = 'rounded-md bg-brand px-4 py-2'
    expect(cn(componentDefault, 'bg-accent')).toContain('bg-accent')
    expect(cn(componentDefault, 'bg-accent')).not.toContain('bg-brand')
    // Non-conflicting defaults survive the override.
    expect(cn(componentDefault, 'bg-accent')).toContain('rounded-md')
  })

  it('handles the project custom colour tokens', () => {
    // These come from @theme in globals.css rather than Tailwind's palette, so
    // tailwind-merge has to recognise them as the same conflict group.
    expect(cn('text-fg', 'text-fg-muted')).toBe('text-fg-muted')
    expect(cn('bg-tone-fact-bg', 'bg-tone-opinion-bg')).toBe('bg-tone-opinion-bg')
  })
})
