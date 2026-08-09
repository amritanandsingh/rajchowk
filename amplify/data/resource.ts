import { a, defineData, type ClientSchema } from '@aws-amplify/backend'

import { saveArticle } from '../functions/save-article/resource'
import { setArticleStatus } from '../functions/set-article-status/resource'

/**
 * ============================================================================
 * राज चौक — data schema
 * ============================================================================
 *
 * THE CENTRAL AUTHORIZATION IDEA — read this before changing any rule.
 *
 * Amplify model-level authorization cannot express "guests may read rows
 * WHERE status == PUBLISHED". If `Article` carried
 * `allow.guest().to(['read'])`, a guest could call
 *
 *     listArticles({ filter: { status: { eq: 'DRAFT' } } })
 *
 * and read unpublished work. Model auth grants access to the OPERATION, not to
 * a row subset, and no filter argument is trustworthy because the caller
 * supplies it.
 *
 * So this schema does not try to filter. It removes the capability, in four
 * layers:
 *
 *  1. `Article` carries NO public authorization rule at all. The generated
 *     `listArticles` / `getArticle` fields therefore carry no API-key or IAM
 *     directive, and the attack is not filtered — it is unrepresentable.
 *  2. `disableOperations` deletes the mutations that must not exist. Every
 *     write goes through a Lambda; there is no `createArticle` mutation for a
 *     client to call directly, so "the backend must independently verify
 *     authorization before allowing article creation" is structural.
 *  3. The entire public read surface is APPSYNC_JS custom queries returning
 *     purpose-built custom types, with the status hard-coded server-side into
 *     the index partition key the caller cannot influence.
 *  4. Field-level `.to(['read'])` acts as a WRITE LOCK: status, feedKey,
 *     statusKey, publishedAt and the author identity can only be written by a
 *     Lambda holding scoped table IAM, never by any GraphQL mutation.
 *
 * The design fails closed. A public resolver's partition key is the literal
 * 'PUBLISHED', computed inside the resolver, plus a redundant status filter.
 * A stale feedKey could only ever HIDE a published article, never reveal an
 * unpublished one.
 *
 * Returning a custom type (`PublicArticle`) rather than `a.ref('Article')` is
 * deliberate: it dodges a type-level auth-directive mismatch for the API-key
 * principal, and it makes leaking an editor-only field impossible to express
 * rather than merely forbidden — a new field on `Article` cannot appear in a
 * public response unless someone also adds it to the resolver's allowlist.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PUBLIC QUERIES USE API-KEY AND NOT `allow.guest()`
 *
 * Amplify rejects identity-pool (guest IAM) authorization on
 * `a.handler.custom`, so an APPSYNC_JS query cannot be granted to guests. The
 * public surface must therefore be `allow.publicApiKey()`.
 *
 * That is safe here specifically because no browser ever holds the key: every
 * public read happens inside `import 'server-only'` modules during SSR/ISR
 * (src/lib/amplify/queries.ts), so the key stays in the server bundle. The key
 * expires and must be rotated — see `apiKeyAuthorizationMode` below and the
 * README's "AWS Resources" section.
 * ============================================================================
 */

const ADMIN = 'ADMIN'

/** Mirrors ArticleStatus. Kept as a plain const so resolvers and Lambdas can
 *  be checked against the same two strings the enum declares. */
const schema = a.schema({
  /* =====================================================================
   * Enums
   * ===================================================================== */

  /**
   * Two states, exactly as the specification recommends.
   *
   * "Unpublish" returns an article to DRAFT rather than introducing a third
   * UNPUBLISHED state: the reader-visible effect is identical, and a third
   * state would need its own transition rules and its own feed semantics for
   * no MVP benefit.
   */
  ArticleStatus: a.enum(['DRAFT', 'PUBLISHED']),

  /* =====================================================================
   * Article — the only model in the system
   * ===================================================================== */

  Article: a
    .model({
      // ---- Editor-authored content. Written only by the save-article
      // ---- Lambda, which validates every field before it lands.
      title: a.string().required(),
      slug: a.string().required(),
      summary: a.string().required(),
      /** Markdown. Rendered through rehype-sanitize; never as an HTML string. */
      content: a.string().required(),

      // ---- Timestamps. Declared explicitly rather than relying on
      // ---- Amplify's implicit createdAt/updatedAt, because implicit
      // ---- timestamps CANNOT be used as GSI sort keys and the admin index
      // ---- below sorts on updatedAt.
      createdAt: a.datetime(),
      updatedAt: a.datetime(),

      // ---- LAMBDA-OWNED. `.to(['read'])` means no GraphQL mutation can
      // ---- write these — the field-level rule REPLACES the model rule for
      // ---- that field, and it grants read only. The save-article and
      // ---- set-article-status handlers write them with scoped table IAM,
      // ---- bypassing AppSync entirely. This is what makes `status`
      // ---- trustworthy enough for the public feed to be gated on it.
      //
      // ---- None of them are .required(): a field that is both required and
      // ---- field-level read-only could never be written by any principal,
      // ---- so the row could not be created. Readers treat a missing value
      // ---- as the safe default (DRAFT, i.e. not public), so it fails closed.
      status: a.ref('ArticleStatus').authorization((allow) => [allow.group(ADMIN).to(['read'])]),

      /**
       * Public feed partition key. Literally 'PUBLISHED', or ABSENT.
       *
       * Absent is the important half. Because the attribute is removed when
       * an article is not published, `articlesByFeedKeyAndPublishedAt` is a
       * SPARSE index: drafts do not merely fail a filter, they have no entry
       * in the index at all. Unpublishing deletes the index entry rather
       * than relying on a filter to hide it.
       */
      feedKey: a.string().authorization((allow) => [allow.group(ADMIN).to(['read'])]),

      /** Admin list partition key: 'DRAFT' | 'PUBLISHED'. Always present, so
       *  the admin index can enumerate both states without a table Scan. */
      statusKey: a.string().authorization((allow) => [allow.group(ADMIN).to(['read'])]),

      publishedAt: a.datetime().authorization((allow) => [allow.group(ADMIN).to(['read'])]),

      /** Byline. Derived from the verified Cognito claim, never from client
       *  input — a client-supplied author would be trivial impersonation. */
      authorName: a.string().authorization((allow) => [allow.group(ADMIN).to(['read'])]),
      /** The author's Cognito `sub`. Never leaves the backend: no public
       *  resolver names it in its allowlist. */
      authorSub: a.string().authorization((allow) => [allow.group(ADMIN).to(['read'])]),
    })
    .secondaryIndexes((index) => [
      /**
       * THE PUBLIC FEED. One Query, newest first, never a Scan.
       *
       * INCLUDE rather than ALL keeps index items around 1 KB, so a 12-item
       * page costs ~2 RCU instead of dragging twelve full article bodies
       * through the index. `content` is deliberately absent — the feed shows
       * summaries, and the article page fetches the body by slug.
       *
       * `status` IS in the projection because the resolver applies it as a
       * redundant filter; if it were missing the filter would match nothing
       * and the feed would silently come back empty.
       */
      index('feedKey')
        .sortKeys(['publishedAt'])
        .name('articlesByFeedKeyAndPublishedAt')
        // No queryField: this index must not be reachable as a generated
        // GraphQL field. The APPSYNC_JS resolver is the only caller.
        .queryField(null)
        .projection('INCLUDE', ['slug', 'title', 'summary', 'authorName', 'status', 'updatedAt']),

      /** Article detail by slug, and the uniqueness check the save handler
       *  runs before writing. Also never a Scan. */
      index('slug').name('articlesBySlug').queryField(null).projection('ALL'),

      /** The admin list. Amplify's generated `Article.list()` is a table
       *  Scan; this makes the admin dashboard a Query too. */
      index('statusKey')
        .sortKeys(['updatedAt'])
        .name('articlesByStatusKeyAndUpdatedAt')
        .queryField(null)
        .projection('INCLUDE', ['slug', 'title', 'summary', 'authorName', 'publishedAt']),
    ])
    .authorization((allow) => [
      // Administrators may READ the model directly (the admin dashboard
      // fetches a single article for the edit form this way). They may not
      // create, update or delete through GraphQL — see disableOperations.
      allow.group(ADMIN).to(['read']),
    ])
    /**
     * Every write operation is deleted from the API.
     *
     * With no createArticle/updateArticle/deleteArticle mutation in the
     * schema, "the backend independently verifies authorization before
     * allowing article creation" is not a check that could be forgotten —
     * there is no unchecked path to forget. The only way to write an Article
     * is the saveArticle / setArticleStatus mutations below, both of which
     * re-derive the caller's identity from the verified JWT inside the
     * Lambda.
     *
     * Subscriptions go too: they would stream DRAFT rows to any subscriber
     * the model rule admits, and nothing in the product needs them.
     */
    .disableOperations(['create', 'update', 'delete', 'subscriptions']),

  /* =====================================================================
   * Public read surface — custom types
   *
   * These are the ONLY shapes an anonymous visitor can ever receive. A
   * sensitive field added to `Article` later cannot leak through them
   * without someone also adding it here AND to the resolver's allowlist.
   * ===================================================================== */

  PublicArticleCard: a.customType({
    id: a.id().required(),
    slug: a.string().required(),
    title: a.string().required(),
    summary: a.string().required(),
    authorName: a.string(),
    publishedAt: a.datetime(),
  }),

  PublicArticleFeed: a.customType({
    items: a.ref('PublicArticleCard').array().required(),
    nextToken: a.string(),
  }),

  PublicArticle: a.customType({
    id: a.id().required(),
    slug: a.string().required(),
    title: a.string().required(),
    summary: a.string().required(),
    content: a.string().required(),
    authorName: a.string(),
    publishedAt: a.datetime(),
    updatedAt: a.datetime(),
  }),

  /* =====================================================================
   * Admin read surface — custom type
   *
   * Separate from PublicArticleCard because it carries `status`, which no
   * public shape may include.
   * ===================================================================== */

  AdminArticleCard: a.customType({
    id: a.id().required(),
    slug: a.string().required(),
    title: a.string().required(),
    summary: a.string().required(),
    status: a.string().required(),
    authorName: a.string(),
    publishedAt: a.datetime(),
    updatedAt: a.datetime(),
  }),

  AdminArticleList: a.customType({
    items: a.ref('AdminArticleCard').array().required(),
    nextToken: a.string(),
  }),

  /* =====================================================================
   * Write results
   *
   * A discriminated result rather than a thrown GraphQL error: the UI needs
   * to tell "your title is too short" (show it on the field) apart from
   * "the API is down" (show an error state), and a stringly-typed error
   * message is a bad channel for that. `code` is a stable contract with
   * src/lib/domain/result-code.ts.
   * ===================================================================== */

  ArticleMutationResult: a.customType({
    ok: a.boolean().required(),
    code: a.string(),
    /** The resulting article id, so the client can navigate after a save. */
    articleId: a.id(),
    slug: a.string(),
    status: a.string(),
  }),

  /* =====================================================================
   * Public queries — APPSYNC_JS, no Lambda, no cold start
   *
   * A JS resolver on the DynamoDB data source is the cheapest and fastest
   * thing that can serve these, and it keeps the public read path free of
   * any compute we have to keep warm or patch.
   * ===================================================================== */

  listPublishedArticles: a
    .query()
    .arguments({
      limit: a.integer(),
      nextToken: a.string(),
    })
    .returns(a.ref('PublicArticleFeed'))
    .authorization((allow) => [allow.publicApiKey()])
    .handler(
      a.handler.custom({
        dataSource: a.ref('Article'),
        entry: './resolvers/list-published-articles.js',
      }),
    ),

  getPublishedArticleBySlug: a
    .query()
    .arguments({ slug: a.string().required() })
    .returns(a.ref('PublicArticle'))
    .authorization((allow) => [allow.publicApiKey()])
    .handler(
      a.handler.custom({
        dataSource: a.ref('Article'),
        entry: './resolvers/get-published-article.js',
      }),
    ),

  /* =====================================================================
   * Admin query
   * ===================================================================== */

  listArticlesForAdmin: a
    .query()
    .arguments({
      status: a.string(),
      limit: a.integer(),
      nextToken: a.string(),
    })
    .returns(a.ref('AdminArticleList'))
    .authorization((allow) => [allow.group(ADMIN)])
    .handler(
      a.handler.custom({
        dataSource: a.ref('Article'),
        entry: './resolvers/list-admin-articles.js',
      }),
    ),

  /* =====================================================================
   * Write mutations — the only path to an Article row
   *
   * `allow.group(ADMIN)` is AppSync's own check against the verified
   * `cognito:groups` claim, so a non-admin's request never reaches the
   * function. The handlers re-derive the same predicate from
   * `event.identity` anyway: defence in depth, and the handler is the layer
   * that also enforces the transition rules AppSync knows nothing about.
   * ===================================================================== */

  saveArticle: a
    .mutation()
    .arguments({
      /**
       * Client-generated UUIDv4, one per form mount. This IS the idempotency
       * key: create is a conditional PutItem on `attribute_not_exists(id)`,
       * so a double-clicked submit cannot produce two articles. Absent means
       * "the server picks one" and is only used by non-browser callers.
       */
      id: a.id(),
      title: a.string().required(),
      summary: a.string().required(),
      content: a.string().required(),
      /** Optional. Auto-derived from the title when omitted — which is the
       *  normal case for a Devanagari headline, since it has no ASCII form. */
      slug: a.string(),
    })
    .returns(a.ref('ArticleMutationResult'))
    .authorization((allow) => [allow.group(ADMIN)])
    .handler(a.handler.function(saveArticle)),

  setArticleStatus: a
    .mutation()
    .arguments({
      articleId: a.id().required(),
      /** 'PUBLISH' | 'UNPUBLISH'. Validated against the transition table. */
      action: a.string().required(),
    })
    .returns(a.ref('ArticleMutationResult'))
    .authorization((allow) => [allow.group(ADMIN)])
    .handler(a.handler.function(setArticleStatus)),
})

/**
 * THERE IS DELIBERATELY NO SCHEMA-LEVEL `.authorization([allow.resource(fn)])`.
 *
 * That call grants a function permission to CALL this API, and it is not
 * subtle about it — inspected on the deployed role, it attaches:
 *
 *   appsync:GraphQL on apis/<id>/types/Query/*
 *                      apis/<id>/types/Mutation/*
 *                      apis/<id>/types/Subscription/*
 *
 * i.e. every operation, for every function listed. `save-article` would be
 * able to invoke `setArticleStatus` and `listArticlesForAdmin`, which is
 * exactly the privilege separation this schema is built to enforce.
 *
 * Neither handler calls the GraphQL API — both talk to DynamoDB through the
 * SDK with a narrowly scoped table policy (see grantTables in
 * amplify/backend.ts). So the grant bought nothing and widened the blast
 * radius of a compromised function.
 *
 * It is NOT required for typing either, which is the usual reason people add
 * it: `Schema['saveArticle']['functionHandler']` comes from
 * `a.mutation().handler(a.handler.function(fn))` above, not from this.
 *
 * Add it back only if a handler genuinely needs to query the API, and then
 * only for that one function.
 */

export type Schema = ClientSchema<typeof schema>

export const data = defineData({
  schema,
  authorizationModes: {
    // Admin sessions. The Next.js middleware and every /admin page authorise
    // against this pool's tokens.
    defaultAuthorizationMode: 'userPool',
    apiKeyAuthorizationMode: {
      /**
       * 365 days is the AWS maximum, and this key is a rotation obligation,
       * not a set-and-forget value: when it expires, every public page starts
       * returning an empty feed rather than an error, because `unwrap()` in
       * src/lib/amplify/queries.ts logs and degrades to null.
       *
       * Rotating it is a redeploy — CloudFormation issues a new key and
       * amplify_outputs.json is regenerated. Diarise it. See the README.
       */
      expiresInDays: 365,
    },
  },
})
