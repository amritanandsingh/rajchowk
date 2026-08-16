import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SearchBox } from './search-box'

/**
 * The search box.
 *
 * What is worth testing here is not that an input renders, but that the three
 * properties the design depends on hold:
 *
 *  1. it is a GET form pointing at `/` — that is what makes search work with
 *     no JavaScript, and what makes a result page shareable;
 *  2. the control has an accessible name despite having no visible label —
 *     axe runs over this page in CI and a nameless input fails it outright;
 *  3. the current term round-trips into the field, so submitting twice does
 *     not silently clear what the reader typed.
 */

describe('SearchBox', () => {
  it('is a search landmark, so it can be jumped to rather than tabbed to', () => {
    render(<SearchBox q="" />)
    expect(screen.getByRole('search')).toBeInTheDocument()
  })

  it('submits as a GET to the feed, which is what makes it work without JS', () => {
    // If this ever becomes a POST or grows an onSubmit handler, the URL stops
    // being the state and a bookmarked search stops working.
    render(<SearchBox q="" />)

    const form = screen.getByRole('search')
    expect(form).toHaveAttribute('method', 'get')
    expect(form).toHaveAttribute('action', '/')
  })

  it('gives the input an accessible name from a visually hidden label', () => {
    render(<SearchBox q="" />)
    // getByRole with a name is the assertion axe would make: a placeholder is
    // not a label, and it disappears the moment anything is typed.
    expect(screen.getByRole('searchbox', { name: 'लेख खोजें' })).toBeInTheDocument()
  })

  it('sends the term as `q`, the parameter the homepage reads', () => {
    render(<SearchBox q="" />)
    expect(screen.getByRole('searchbox')).toHaveAttribute('name', 'q')
  })

  it('shows the current term, so a second search does not start from blank', () => {
    render(<SearchBox q="चुनाव" />)
    expect(screen.getByRole('searchbox')).toHaveValue('चुनाव')
  })

  it('caps what can be typed at the same limit the data layer enforces', () => {
    render(<SearchBox q="" />)
    expect(screen.getByRole('searchbox')).toHaveAttribute('maxlength', '80')
  })

  it('offers a way back to the full feed only while a search is active', () => {
    const { unmount } = render(<SearchBox q="" />)
    expect(screen.queryByRole('link', { name: 'खोज हटाएँ' })).not.toBeInTheDocument()
    unmount()

    render(<SearchBox q="चुनाव" />)
    // A link rather than a reset button: clearing a search is a navigation,
    // and a navigation needs no JavaScript.
    expect(screen.getByRole('link', { name: 'खोज हटाएँ' })).toHaveAttribute('href', '/')
  })
})
