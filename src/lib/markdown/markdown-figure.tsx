import Image from 'next/image'

/**
 * An editor-inserted image.
 *
 * The src is validated in remarkDirectiveToData against our own media origins
 * before it reaches here, and again by next/image's `remotePatterns`. Alt text
 * is mandatory at insert time — a figure without it is dropped rather than
 * rendered — so this component never emits a decorative-by-accident image.
 */
export function MarkdownFigure({
  src,
  alt,
  caption,
}: {
  src: string
  alt: string
  caption?: string
}) {
  if (!src || !alt) return null

  return (
    <figure className="my-6">
      <div className="relative aspect-[3/2] overflow-hidden rounded-card bg-bg-subtle">
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 48rem) 46rem, 100vw"
          className="object-cover"
        />
      </div>
      {caption && <figcaption className="mt-2 text-sm text-fg-muted">{caption}</figcaption>}
    </figure>
  )
}
