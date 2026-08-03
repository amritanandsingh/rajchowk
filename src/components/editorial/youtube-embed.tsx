'use client'

import Image from 'next/image'
import { useState } from 'react'
import { youTubeEmbedUrl, youTubeThumbnailUrl } from '@/lib/domain/youtube'
import { useDictionary } from '@/components/providers'
import { t } from '@/lib/i18n'

/**
 * Click-to-load YouTube embed.
 *
 * Renders a thumbnail and a play button; the iframe is only mounted after an
 * explicit click. Three things this buys:
 *
 *  - No third-party JavaScript or cookies load on page view, which keeps the
 *    consent story under India's DPDP Act simple and honest.
 *  - Roughly 450 KB and several requests saved per embed on a page that may
 *    carry more than one.
 *  - `frame-src` in the CSP is exactly one origin.
 *
 * The id is validated at authoring time and again by youTubeEmbedUrl, which
 * throws rather than emitting a URL for anything that is not 11 base64url
 * characters.
 */
export function YouTubeEmbed({
  videoId,
  title,
  caption,
}: {
  videoId: string
  title?: string
  caption?: string
}) {
  const [playing, setPlaying] = useState(false)
  const dict = useDictionary()

  const label = title ?? caption ?? dict.article.watchAnalysis

  return (
    <figure className="my-6">
      <div className="relative aspect-video overflow-hidden rounded-card bg-bg-subtle">
        {playing ? (
          <iframe
            src={youTubeEmbedUrl(videoId, { autoplay: true })}
            title={label}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 size-full border-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={t(dict.a11y.playVideo, { title: label })}
            className="group absolute inset-0 size-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Image
              src={youTubeThumbnailUrl(videoId, 'hq')}
              alt=""
              fill
              sizes="(min-width: 48rem) 46rem, 100vw"
              className="object-cover"
            />
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/35 motion-reduce:transition-none"
            >
              <span className="flex size-16 items-center justify-center rounded-full bg-accent shadow-raised">
                {/* Inline so the play affordance never depends on an icon font
                    or a JS-loaded sprite. */}
                <svg viewBox="0 0 24 24" fill="currentColor" className="ml-1 size-7 text-accent-fg">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
          </button>
        )}
      </div>
      {caption && <figcaption className="mt-2 text-sm text-fg-muted">{caption}</figcaption>}
    </figure>
  )
}
