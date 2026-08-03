import { defineFunction } from '@aws-amplify/backend'

/**
 * Tag feed.
 *
 * This is a Lambda rather than an APPSYNC_JS resolver for a concrete reason:
 * the query needs a Query on the ArticleTag join index followed by a
 * BatchGetItem on the Article table, and APPSYNC_JS BatchGetItem requires
 * PHYSICAL DynamoDB table names, which are not knowable when the resolver is
 * authored. AppSync rejects the resolver outright ("The code contains one or
 * more errors"). A Lambda receives the table names via addEnvironment.
 *
 * The cost is a cold start on tag pages. That is an acceptable trade: tag
 * pages are a long-tail surface, unlike the homepage and article pages, which
 * stay on zero-cold-start APPSYNC_JS resolvers.
 *
 * `resourceGroupName: 'data'` is required — see the note in cast-vote/resource.ts.
 */
export const listArticlesByTag = defineFunction({
  name: 'list-articles-by-tag',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 15,
  memoryMB: 512,
  resourceGroupName: 'data',
  environment: {
    POWERTOOLS_SERVICE_NAME: 'list-articles-by-tag',
    POWERTOOLS_LOG_LEVEL: 'INFO',
  },
})
