export default function Loading() {
  return (
    <main
      className="mx-auto min-h-[55vh] max-w-7xl px-4 py-10"
      aria-busy="true"
      aria-label="लोड हो रहा है"
    >
      <div className="h-10 w-52 animate-pulse rounded bg-bg-subtle" />
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-64 animate-pulse rounded-card bg-bg-subtle" />
        ))}
      </div>
    </main>
  )
}
