import 'server-only'

import type {
  BreadcrumbList,
  NewsArticle,
  Organization,
  Person,
  VideoObject,
  WebSite,
  WithContext,
} from 'schema-dts'
import type { PublicArticle } from '@/lib/amplify/queries'
import { youTubeEmbedUrl, youTubeThumbnailUrl, youTubeWatchUrl } from '@/lib/domain/youtube'
import { absoluteUrl, env } from '@/lib/env'

/**
 * JSON-LD builders.
 *
 * Pure functions returning typed objects, so they are unit-testable and the
 * `@id` references stay consistent across the site. `schema-dts` catches
 * misspelled properties at compile time, which is most of what goes wrong
 * with structured data.
 */

const ORG_ID = `${env.NEXT_PUBLIC_SITE_URL}#organization`
const SITE_ID = `${env.NEXT_PUBLIC_SITE_URL}#website`

export function buildOrganizationLd(): WithContext<Organization> {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsMediaOrganization',
    '@id': ORG_ID,
    name: env.NEXT_PUBLIC_SITE_NAME,
    url: env.NEXT_PUBLIC_SITE_URL,
    logo: absoluteUrl('/logo.png'),
    // These four are what Google News looks for to establish editorial
    // accountability, and they are the machine-readable half of the
    // fact/opinion separation the site claims.
    ethicsPolicy: absoluteUrl('/editorial-policy'),
    correctionsPolicy: absoluteUrl('/corrections-policy'),
    publishingPrinciples: absoluteUrl('/editorial-policy'),
    actionableFeedbackPolicy: absoluteUrl('/contact'),
  }
}

export function buildWebSiteLd(): WithContext<WebSite> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': SITE_ID,
    name: env.NEXT_PUBLIC_SITE_NAME,
    url: env.NEXT_PUBLIC_SITE_URL,
    inLanguage: 'hi-IN',
    publisher: { '@id': ORG_ID },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${env.NEXT_PUBLIC_SITE_URL}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
    // Cast the whole object: schema-dts declares potentialAction's value type
    // as non-optional once the key is present, which exactOptionalPropertyTypes
    // rejects when it is written inline.
  } as WithContext<WebSite>
}

export function buildPersonLd(person: {
  name: string
  slug: string
  bio?: string | null
  imageUrl?: string | null
}): WithContext<Person> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${absoluteUrl(`/author/${person.slug}`)}#person`,
    name: person.name,
    url: absoluteUrl(`/author/${person.slug}`),
    ...(person.bio ? { description: person.bio } : {}),
    ...(person.imageUrl ? { image: person.imageUrl } : {}),
    worksFor: { '@id': ORG_ID },
  }
}

/**
 * Picks the NewsArticle subtype from the content type.
 *
 * This is the schema.org vocabulary for exactly the distinction the product
 * is built on, so it is worth getting right rather than tagging everything
 * `NewsArticle`.
 */
function articleType(contentType: string | null | undefined): NewsArticle['@type'] {
  switch (contentType) {
    case 'OPINION':
    case 'EDITORIAL':
      return 'OpinionNewsArticle'
    case 'ANALYSIS':
      return 'AnalysisNewsArticle'
    case 'EXPLAINER':
    case 'FACT_CHECK':
      return 'BackgroundNewsArticle'
    default:
      return 'ReportageNewsArticle'
  }
}

export function buildArticleLd(
  article: PublicArticle,
  options: { path: string; imageUrl?: string | null; authorSlug?: string | null },
): WithContext<NewsArticle> {
  const url = absoluteUrl(options.path)

  const jsonLd: WithContext<NewsArticle> = {
    '@context': 'https://schema.org',
    '@type': articleType(article.contentType),
    '@id': `${url}#article`,
    url,
    mainEntityOfPage: url,
    // Google truncates a headline past ~110 characters.
    headline: article.title.slice(0, 110),
    ...(article.excerpt ? { description: article.excerpt } : {}),
    inLanguage: article.language === 'EN' ? 'en-IN' : 'hi-IN',
    ...(article.publishedAt ? { datePublished: article.publishedAt } : {}),
    ...(article.updatedAt ? { dateModified: article.updatedAt } : {}),
    author: options.authorSlug
      ? { '@id': `${absoluteUrl(`/author/${options.authorSlug}`)}#person` }
      : { '@type': 'Person', name: article.authorDisplayName ?? env.NEXT_PUBLIC_SITE_NAME },
    publisher: { '@id': ORG_ID },
    isAccessibleForFree: true,
    ...(options.imageUrl ? { image: options.imageUrl } : {}),
    ...(article.wordCount ? { wordCount: article.wordCount } : {}),
  }

  // A machine-readable correction is what makes the corrections policy real
  // rather than a page nobody reads.
  if (article.correctionNotice && article.correctedAt) {
    jsonLd.correction = {
      '@type': 'CorrectionComment',
      text: article.correctionNotice.slice(0, 500),
      datePublished: article.correctedAt,
    }
  }

  if (article.youtubeVideoId) {
    jsonLd.video = buildVideoLd({
      videoId: article.youtubeVideoId,
      name: article.title,
      description: article.excerpt ?? article.title,
      uploadDate: article.publishedAt ?? undefined,
    })
  }

  return jsonLd
}

export function buildVideoLd(video: {
  videoId: string
  name: string
  description: string
  uploadDate?: string | undefined
}): VideoObject {
  return {
    '@type': 'VideoObject',
    name: video.name.slice(0, 110),
    description: video.description.slice(0, 500),
    thumbnailUrl: youTubeThumbnailUrl(video.videoId, 'maxres'),
    ...(video.uploadDate ? { uploadDate: video.uploadDate } : {}),
    embedUrl: youTubeEmbedUrl(video.videoId),
    contentUrl: youTubeWatchUrl(video.videoId),
  }
}

export function buildBreadcrumbLd(
  crumbs: Array<{ name: string; path: string }>,
): WithContext<BreadcrumbList> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  }
}
