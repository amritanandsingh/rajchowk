/**
 * Grid-shaped skeleton for a taxonomy listing.
 *
 * These routes have no generateStaticParams, so EVERY category and tag page
 * pays two sequential AppSync round trips on its first request — the term, then
 * its articles. That is exactly when a correctly-shaped skeleton earns its
 * keep.
 */
export default function Loading() {
  return (
    <main
      className="mx-auto min-h-[55vh] max-w-7xl px-4 py-8 sm:py-10"
      aria-busy="true"
      aria-label="लोड हो रहा है"
    >
      <div className="border-b border-border pb-6">
        <div className="h-9 w-64 animate-pulse rounded bg-bg-subtle sm:h-11" />
        <div className="mt-3 h-4 w-80 animate-pulse rounded bg-bg-subtle" />
      </div>
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-64 animate-pulse rounded-card bg-bg-subtle" />
        ))}
      </div>
    </main>
  )
}
