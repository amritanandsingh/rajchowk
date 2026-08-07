/**
 * Article-shaped skeleton.
 *
 * Without this, the app-root loading.tsx applied here — a SIX-CARD GRID shown
 * while a single article loads. The shape of a skeleton is the whole point of
 * having one: a grid promises a list and then delivers a story, which reads as
 * a broken page rather than a loading one. It also matters more on this route
 * than anywhere else, because articles are generated on demand.
 */
export default function Loading() {
  return (
    <main
      className="mx-auto max-w-3xl px-4 py-8 sm:py-12"
      aria-busy="true"
      aria-label="लेख लोड हो रहा है"
    >
      {/* Headline: two lines, second short, like real balanced Devanagari text. */}
      <div className="h-9 animate-pulse rounded bg-bg-subtle sm:h-11" />
      <div className="mt-3 h-9 w-3/5 animate-pulse rounded bg-bg-subtle sm:h-11" />
      {/* Byline + meta row. */}
      <div className="mt-6 h-4 w-48 animate-pulse rounded bg-bg-subtle" />
      {/* Hero, matching the real aspect-video figure. */}
      <div className="mt-8 aspect-video animate-pulse rounded-card bg-bg-subtle" />
      {/* Body paragraphs. The last is short, as a closing line usually is. */}
      <div className="mt-8 space-y-4">
        {['w-full', 'w-full', 'w-11/12', 'w-full', 'w-4/5'].map((width) => (
          <div key={width} className={`h-5 animate-pulse rounded bg-bg-subtle ${width}`} />
        ))}
      </div>
    </main>
  )
}
