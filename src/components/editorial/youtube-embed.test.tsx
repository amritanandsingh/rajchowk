import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Providers } from '@/components/providers'
import { YouTubeEmbed } from './youtube-embed'

/**
 * The click-to-load YouTube facade.
 *
 * The property that matters is the privacy one: NO third-party iframe exists in
 * the DOM until the reader explicitly clicks. That is what keeps the DPDP
 * consent story honest and keeps `frame-src` down to a single origin — and it
 * is entirely invisible unless asserted.
 */

const VIDEO_ID = 'dQw4w9WgXcQ'

function renderEmbed(props: Parameters<typeof YouTubeEmbed>[0]) {
  return render(
    <Providers initialLocale="hi">
      <YouTubeEmbed {...props} />
    </Providers>,
  )
}

describe('YouTubeEmbed', () => {
  it('loads NO iframe before the reader clicks', () => {
    const { container } = renderEmbed({ videoId: VIDEO_ID })

    // The whole point of the facade.
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('shows a play button with an accessible name', () => {
    renderEmbed({ videoId: VIDEO_ID, title: 'अमृत का विश्लेषण' })

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
    expect(button.getAttribute('aria-label')).toContain('अमृत का विश्लेषण')
  })

  it('falls back to the dictionary label when no title is given', () => {
    renderEmbed({ videoId: VIDEO_ID })
    expect(screen.getByRole('button').getAttribute('aria-label')).toBeTruthy()
  })

  it('shows a thumbnail from i.ytimg.com, the only YouTube host in img-src', () => {
    const { container } = renderEmbed({ videoId: VIDEO_ID })
    const image = container.querySelector('img')

    expect(image).not.toBeNull()
    // next/image rewrites the src, so assert on the encoded original.
    const src = image?.getAttribute('src') ?? ''
    expect(decodeURIComponent(src)).toContain('i.ytimg.com')
    expect(decodeURIComponent(src)).toContain(VIDEO_ID)
  })

  it('gives the thumbnail empty alt text — the button carries the name', () => {
    // A described thumbnail plus a labelled button would announce twice.
    const { container } = renderEmbed({ videoId: VIDEO_ID, title: 'x' })
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('')
  })

  it('mounts the youtube-nocookie player only AFTER a click', async () => {
    const { container } = renderEmbed({ videoId: VIDEO_ID, title: 'वीडियो' })

    await userEvent.click(screen.getByRole('button'))

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()

    const src = iframe?.getAttribute('src') ?? ''
    // Privacy-enhanced host, and no cookie is set until playback.
    expect(src).toContain('https://www.youtube-nocookie.com/embed/')
    expect(src).toContain(VIDEO_ID)
    // Never the tracking host.
    expect(src).not.toContain('://www.youtube.com/embed')
  })

  it('autoplays once clicked, since the click was the intent', async () => {
    const { container } = renderEmbed({ videoId: VIDEO_ID })
    await userEvent.click(screen.getByRole('button'))
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain('autoplay=1')
  })

  it('sets the Hindi player and caption language', async () => {
    const { container } = renderEmbed({ videoId: VIDEO_ID })
    await userEvent.click(screen.getByRole('button'))

    const src = container.querySelector('iframe')?.getAttribute('src') ?? ''
    expect(src).toContain('hl=hi')
    expect(src).toContain('cc_lang_pref=hi')
  })

  it('titles the iframe, so it is not an unlabelled frame', async () => {
    renderEmbed({ videoId: VIDEO_ID, title: 'अमृत का विश्लेषण' })
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByTitle('अमृत का विश्लेषण')).toBeInTheDocument()
  })

  it('renders a caption when supplied', () => {
    renderEmbed({ videoId: VIDEO_ID, caption: 'चुनाव पर चर्चा' })
    expect(screen.getByText('चुनाव पर चर्चा')).toBeInTheDocument()
  })

  it('is reachable and activatable by keyboard alone', async () => {
    const { container } = renderEmbed({ videoId: VIDEO_ID })

    await userEvent.tab()
    expect(screen.getByRole('button')).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('reserves 16:9 space, so loading the player causes no layout shift', () => {
    const { container } = renderEmbed({ videoId: VIDEO_ID })
    expect(container.querySelector('.aspect-video')).not.toBeNull()
  })

  it('throws for an invalid id rather than emitting a broken embed', () => {
    // youTubeThumbnailUrl/youTubeEmbedUrl refuse unvalidated input. Reaching
    // here with a bad id is a programming error and should be loud.
    expect(() => renderEmbed({ videoId: 'not-valid' })).toThrow(/invalid video id/)
  })
})
