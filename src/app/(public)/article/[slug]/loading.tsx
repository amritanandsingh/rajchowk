import { Container } from '@/components/ui/container'
import { getDictionary } from '@/lib/i18n/hi'

/** Streamed while an uncached article is fetched. The bar widths approximate a
 *  headline, a summary and body copy so the layout does not shift on arrival. */
export default function ArticleLoading() {
  const dict = getDictionary()
  return (
    <Container width="prose">
      <span role="status" aria-live="polite" className="sr-only">
        {dict.loading}
      </span>
      <div aria-hidden="true" className="animate-pulse space-y-4 motion-reduce:animate-none">
        <div className="h-9 w-5/6 rounded bg-bg-subtle" />
        <div className="h-9 w-2/3 rounded bg-bg-subtle" />
        <div className="mt-6 h-5 w-full rounded bg-bg-subtle" />
        <div className="h-5 w-4/5 rounded bg-bg-subtle" />
        <div className="mt-8 space-y-3 border-t border-border pt-8">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-4 w-full rounded bg-bg-subtle" />
          ))}
        </div>
      </div>
    </Container>
  )
}
