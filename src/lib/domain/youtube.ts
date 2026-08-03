/**
 * YouTube URL allow-listing.
 *
 * Modules under src/lib/domain/ are shared with the Lambdas in amplify/, which
 * import them by relative path and bundle them with esbuild. They must
 * therefore stay pure: no React, no next/*, no DOM globals, no `@/` aliases.
 *
 * The security property: only a bare 11-character video ID is ever stored.
 * Parsing happens once, at the edge of the system (editor paste, admin API),
 * and the render path never sees a URL at all — so there is no place for a
 * `javascript:` URL or an attacker-chosen origin to reach an iframe src.
 */

/** YouTube video IDs are exactly 11 characters from the base64url alphabet. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** Hosts we accept a video ID from. Anything else is rejected outright. */
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

export function isValidVideoId(value: string): boolean {
  return VIDEO_ID.test(value)
}

/**
 * Extract a video ID from a pasted URL, or from a bare ID.
 *
 * Returns null for anything not on the allow-list. Callers must treat null as
 * "drop this embed", never as "use the input as-is".
 */
export function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // A bare ID pasted directly.
  if (isValidVideoId(trimmed)) return trimmed

  let url: URL
  try {
    // Tolerate a missing scheme, which is how people paste from the address bar.
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }

  // Rejects javascript:, data:, file: and anything else non-navigational.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null

  const host = url.hostname.toLowerCase()

  // youtu.be/<id>
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const candidate = url.pathname.slice(1).split('/')[0] ?? ''
    return isValidVideoId(candidate) ? candidate : null
  }

  // youtube.com/watch?v=<id>
  const v = url.searchParams.get('v')
  if (v && isValidVideoId(v)) return v

  // /embed/<id>, /live/<id>, /shorts/<id>, /v/<id>
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length >= 2) {
    const [prefix, candidate] = segments
    if (
      prefix &&
      candidate &&
      ['embed', 'live', 'shorts', 'v'].includes(prefix) &&
      isValidVideoId(candidate)
    ) {
      return candidate
    }
  }

  return null
}

/**
 * Privacy-enhanced embed URL.
 *
 * youtube-nocookie.com sets no tracking cookie until playback begins, which is
 * what lets the consent story stay simple under India's DPDP Act. The player
 * is only ever mounted after an explicit user click (see YouTubeEmbed), so
 * nothing third-party loads on page view.
 *
 * Throws on an invalid id rather than returning a string: reaching here with
 * unvalidated input is a programming error, and returning a broken URL would
 * hide it.
 */
export function youTubeEmbedUrl(
  videoId: string,
  options: { autoplay?: boolean; language?: string } = {},
): string {
  if (!isValidVideoId(videoId)) {
    throw new Error(`Refusing to build an embed URL for an invalid video id`)
  }

  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    hl: options.language ?? 'hi',
    cc_lang_pref: options.language ?? 'hi',
  })
  if (options.autoplay) params.set('autoplay', '1')

  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`
}

/** Thumbnail URL. `i.ytimg.com` is the only YouTube host in our CSP img-src. */
export function youTubeThumbnailUrl(
  videoId: string,
  quality: 'default' | 'hq' | 'sd' | 'maxres' = 'hq',
): string {
  if (!isValidVideoId(videoId)) {
    throw new Error(`Refusing to build a thumbnail URL for an invalid video id`)
  }
  const file = { default: 'default', hq: 'hqdefault', sd: 'sddefault', maxres: 'maxresdefault' }[
    quality
  ]
  return `https://i.ytimg.com/vi/${videoId}/${file}.jpg`
}

/** Canonical watch URL, for JSON-LD `VideoObject.contentUrl` and share links. */
export function youTubeWatchUrl(videoId: string): string {
  if (!isValidVideoId(videoId)) {
    throw new Error(`Refusing to build a watch URL for an invalid video id`)
  }
  return `https://www.youtube.com/watch?v=${videoId}`
}
