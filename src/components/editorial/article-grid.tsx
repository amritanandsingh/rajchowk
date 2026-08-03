import type { ArticleCard as ArticleCardData } from '@/lib/amplify/queries'
import { ArticleCard } from './article-card'

export function ArticleGrid({ articles }: { articles: ArticleCardData[] }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} />
      ))}
    </div>
  )
}
