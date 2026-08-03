import { describe, expect, it } from 'vitest'
import {
  isValidVideoId,
  parseYouTubeId,
  youTubeEmbedUrl,
  youTubeThumbnailUrl,
  youTubeWatchUrl,
} from './youtube'

const VALID = 'dQw4w9WgXcQ'

describe('isValidVideoId', () => {
  it('accepts exactly 11 base64url characters', () => {
    expect(isValidVideoId(VALID)).toBe(true)
    expect(isValidVideoId('_-aA0123456')).toBe(true)
  })

  it('rejects wrong lengths', () => {
    expect(isValidVideoId('dQw4w9WgXc')).toBe(false)
    expect(isValidVideoId('dQw4w9WgXcQQ')).toBe(false)
    expect(isValidVideoId('')).toBe(false)
  })

  it('rejects characters outside the alphabet', () => {
    expect(isValidVideoId('dQw4w9WgXc!')).toBe(false)
    expect(isValidVideoId('dQw4w9WgXc/')).toBe(false)
    expect(isValidVideoId('dQw4w9WgXc ')).toBe(false)
  })
})

describe('parseYouTubeId', () => {
  it('accepts a bare id', () => {
    expect(parseYouTubeId(VALID)).toBe(VALID)
    expect(parseYouTubeId(`  ${VALID}  `)).toBe(VALID)
  })

  it('parses every URL shape an editor might paste', () => {
    const cases = [
      `https://www.youtube.com/watch?v=${VALID}`,
      `https://youtube.com/watch?v=${VALID}`,
      `https://m.youtube.com/watch?v=${VALID}`,
      `https://youtu.be/${VALID}`,
      `https://www.youtube.com/embed/${VALID}`,
      `https://www.youtube.com/live/${VALID}`,
      `https://www.youtube.com/shorts/${VALID}`,
      `https://www.youtube.com/v/${VALID}`,
      `https://www.youtube-nocookie.com/embed/${VALID}`,
      // Address-bar paste with no scheme.
      `youtube.com/watch?v=${VALID}`,
      `youtu.be/${VALID}`,
    ]
    for (const input of cases) {
      expect(parseYouTubeId(input), input).toBe(VALID)
    }
  })

  it('keeps working with extra query parameters', () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch?v=${VALID}&t=42s&list=PLabc`)).toBe(VALID)
    expect(parseYouTubeId(`https://youtu.be/${VALID}?t=42`)).toBe(VALID)
  })

  it('rejects hosts that are not on the allow-list', () => {
    // The whole point of the allow-list: a look-alike host must not produce an
    // embeddable id.
    expect(parseYouTubeId(`https://evil.com/watch?v=${VALID}`)).toBeNull()
    expect(parseYouTubeId(`https://youtube.com.evil.com/watch?v=${VALID}`)).toBeNull()
    expect(parseYouTubeId(`https://notyoutube.com/watch?v=${VALID}`)).toBeNull()
    expect(parseYouTubeId(`https://vimeo.com/${VALID}`)).toBeNull()
  })

  it('rejects non-navigational schemes', () => {
    expect(parseYouTubeId(`javascript:alert(1)//youtube.com/watch?v=${VALID}`)).toBeNull()
    expect(parseYouTubeId('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(parseYouTubeId('file:///etc/passwd')).toBeNull()
  })

  it('rejects a valid host carrying an invalid id', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=short')).toBeNull()
    expect(parseYouTubeId('https://youtu.be/short')).toBeNull()
    expect(parseYouTubeId('https://www.youtube.com/watch?v=../../etc/passwd')).toBeNull()
  })

  it('rejects channel and playlist URLs, which carry no video', () => {
    expect(parseYouTubeId('https://www.youtube.com/@rajchowk')).toBeNull()
    expect(parseYouTubeId('https://www.youtube.com/playlist?list=PLabc')).toBeNull()
    expect(parseYouTubeId('https://www.youtube.com/')).toBeNull()
  })

  it('rejects empty and malformed input', () => {
    expect(parseYouTubeId('')).toBeNull()
    expect(parseYouTubeId('   ')).toBeNull()
    expect(parseYouTubeId('https://')).toBeNull()
    expect(parseYouTubeId('not a url at all')).toBeNull()
  })

  it('is case-insensitive about the host but not the id', () => {
    expect(parseYouTubeId(`https://WWW.YouTube.com/watch?v=${VALID}`)).toBe(VALID)
    // Video ids are case-sensitive and must be returned verbatim.
    expect(parseYouTubeId('https://youtu.be/DQW4W9WGXCQ')).toBe('DQW4W9WGXCQ')
  })
})

describe('youTubeEmbedUrl', () => {
  it('always uses the no-cookie host', () => {
    expect(youTubeEmbedUrl(VALID)).toContain('https://www.youtube-nocookie.com/embed/')
  })

  it('sets Hindi player language by default', () => {
    const url = youTubeEmbedUrl(VALID)
    expect(url).toContain('hl=hi')
    expect(url).toContain('cc_lang_pref=hi')
  })

  it('omits autoplay unless asked', () => {
    expect(youTubeEmbedUrl(VALID)).not.toContain('autoplay')
    expect(youTubeEmbedUrl(VALID, { autoplay: true })).toContain('autoplay=1')
  })

  it('throws rather than emitting a URL for an invalid id', () => {
    // Reaching here with unvalidated input is a programming error; returning a
    // broken URL would hide it.
    expect(() => youTubeEmbedUrl('nope')).toThrow(/invalid video id/)
    expect(() => youTubeEmbedUrl('"><script>')).toThrow(/invalid video id/)
  })
})

describe('youTubeThumbnailUrl', () => {
  it('uses i.ytimg.com, the only YouTube host in our CSP img-src', () => {
    expect(youTubeThumbnailUrl(VALID)).toBe(`https://i.ytimg.com/vi/${VALID}/hqdefault.jpg`)
  })

  it('supports each quality', () => {
    expect(youTubeThumbnailUrl(VALID, 'maxres')).toContain('maxresdefault.jpg')
    expect(youTubeThumbnailUrl(VALID, 'sd')).toContain('sddefault.jpg')
    expect(youTubeThumbnailUrl(VALID, 'default')).toContain('/default.jpg')
  })

  it('throws on an invalid id', () => {
    expect(() => youTubeThumbnailUrl('../../evil')).toThrow(/invalid video id/)
  })
})

describe('youTubeWatchUrl', () => {
  it('builds the canonical watch URL', () => {
    expect(youTubeWatchUrl(VALID)).toBe(`https://www.youtube.com/watch?v=${VALID}`)
  })

  it('throws on an invalid id', () => {
    expect(() => youTubeWatchUrl('nope')).toThrow(/invalid video id/)
  })
})
