import { listPublishedArticles } from '@/lib/amplify/queries'

export { default, generateMetadata } from '../../news/[slug]/page'

export const revalidate = 60
export const dynamicParams = true

export async function generateStaticParams() {
  const { items } = await listPublishedArticles({ contentType: 'OPINION', limit: 24 })
  return items.map((article) => ({ slug: article.slug }))
}
