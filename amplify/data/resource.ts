import { a, defineData, type ClientSchema } from '@aws-amplify/backend'

import { castVote } from '../functions/cast-vote/resource'
import { ensureUserProfile } from '../functions/ensure-user-profile/resource'
import { listArticlesByTag } from '../functions/list-articles-by-tag/resource'
import { moderateContent } from '../functions/moderate-content/resource'
import { newsletterSubscribe } from '../functions/newsletter-subscribe/resource'
import { newsletterUnsubscribe } from '../functions/newsletter-unsubscribe/resource'
import { newsletterVerify } from '../functions/newsletter-verify/resource'
import { publishArticle } from '../functions/publish-article/resource'
import { reconcileCounters } from '../functions/reconcile-counters/resource'
import { searchContent } from '../functions/search-content/resource'
import { submitComment } from '../functions/submit-comment/resource'
import { submitQuestion } from '../functions/submit-question/resource'
import { submitReport } from '../functions/submit-report/resource'
import { toggleQuestionUpvote } from '../functions/toggle-question-upvote/resource'

/**
 * ============================================================================
 * Raj Chowk data schema
 * ============================================================================
 *
 * THE CENTRAL AUTHORIZATION IDEA — read this before changing any rule.
 *
 * Amplify model-level auth cannot express "guests may read rows WHERE
 * status == PUBLISHED". If `Article` carried `allow.guest().to(['read'])`, a
 * guest could call `listArticles({ filter: { status: { eq: 'DRAFT' } } })` and
 * read unpublished work. So the design does not try to filter — it removes the
 * capability, in four layers:
 *
 *  1. NO public rule on any status-gated model. `listArticles` then carries no
 *     @aws_iam directive at all, so the attack is not filtered, it is
 *     unrepresentable.
 *  2. `disableOperations` deletes operations that have no legitimate caller.
 *     Vote and QuestionUpvote expose NOTHING over GraphQL — that is how
 *     "individual votes are never publicly readable" is guaranteed.
 *  3. The whole public read surface is APPSYNC_JS custom queries returning
 *     purpose-built custom types, with the status hard-coded server-side into
 *     a GSI partition key the caller cannot influence.
 *  4. Field-level `.to(['read'])` acts as a write lock: status, feed keys,
 *     publishedAt and every counter can only be written by a Lambda holding
 *     scoped table IAM, never by a GraphQL mutation.
 *
 * The design fails closed. A public resolver's partition key is
 * 'PUBLISHED#<language>', computed in the resolver, plus a redundant status
 * filter. A stale feed key can only ever HIDE a published article, never
 * reveal an unpublished one.
 *
 * Returning a custom type (`PublicArticle`) rather than `a.ref('Article')` is
 * deliberate: it dodges a type-level auth-directive mismatch for guests, and
 * it makes leaking an editor-only field impossible to express rather than
 * merely forbidden.
 * ============================================================================
 */

const ADMIN = 'ADMIN'
const STAFF = ['ADMIN', 'EDITOR']
const MODERATORS = ['ADMIN', 'EDITOR', 'MODERATOR']

const schema = a
  .schema({
    /* =====================================================================
     * Enums
     * ===================================================================== */

    // UNPUBLISHED (was live, pulled — needs a tombstone) is deliberately
    // distinct from ARCHIVED (aged out of feeds, still reachable at its URL).
    // A news site that issues corrections needs both.
    ArticleStatus: a.enum([
      'DRAFT',
      'IN_REVIEW',
      'SCHEDULED',
      'PUBLISHED',
      'UNPUBLISHED',
      'ARCHIVED',
    ]),
    ContentType: a.enum([
      'NEWS',
      'OPINION',
      'ANALYSIS',
      'EXPLAINER',
      'FACT_CHECK',
      'INTERVIEW',
      'EDITORIAL',
    ]),
    Language: a.enum(['HI', 'EN']),
    SourceKind: a.enum([
      'PRIMARY',
      'WIRE',
      'OFFICIAL_RECORD',
      'DOCUMENT',
      'INTERVIEW',
      'SOCIAL',
      'OTHER',
    ]),
    PollStatus: a.enum(['DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED']),
    QuestionStatus: a.enum([
      'PENDING_REVIEW',
      'APPROVED',
      'PLANNED',
      'ANSWERED',
      'REJECTED',
      'ARCHIVED',
    ]),
    CommentStatus: a.enum(['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN', 'DELETED']),
    LiveEventStatus: a.enum(['DRAFT', 'SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED']),
    // COMPROMISED exists because Indian promise-tracking routinely lands on
    // partially-honoured. Forcing that into NOT_COMPLETED invites entirely
    // fair accusations of bias.
    PromiseStatus: a.enum([
      'ANNOUNCED',
      'IN_PROGRESS',
      'COMPLETED',
      'PARTIALLY_COMPLETED',
      'NOT_COMPLETED',
      'UNVERIFIABLE',
      'ON_HOLD',
    ]),
    ReportReason: a.enum([
      'SPAM',
      'ABUSE',
      'HATE_SPEECH',
      'MISINFORMATION',
      'OFF_TOPIC',
      'PERSONAL_INFO',
      'IMPERSONATION',
      'COPYRIGHT',
      'OTHER',
    ]),
    ReportStatus: a.enum(['OPEN', 'UNDER_REVIEW', 'ACTIONED', 'DISMISSED']),
    SubscriptionStatus: a.enum(['PENDING', 'CONFIRMED', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED']),
    ModerationTarget: a.enum(['COMMENT', 'QUESTION', 'ARTICLE', 'REPORT']),
    ModerationAction: a.enum(['APPROVE', 'REJECT', 'HIDE', 'UNHIDE', 'DELETE', 'DISMISS_REPORT']),
    AuditAction: a.enum([
      'ARTICLE_CREATE',
      'ARTICLE_UPDATE',
      'ARTICLE_PUBLISH',
      'ARTICLE_UNPUBLISH',
      'ARTICLE_SLUG_CHANGE',
      'COMMENT_APPROVE',
      'COMMENT_REJECT',
      'COMMENT_HIDE',
      'COMMENT_DELETE',
      'QUESTION_APPROVE',
      'QUESTION_REJECT',
      'QUESTION_ANSWER',
      'VOTE_CHANGE',
      'POLL_OPEN',
      'POLL_CLOSE',
      'USER_ROLE_GRANT',
      'USER_ROLE_REVOKE',
      'USER_SUSPEND',
      'PROMISE_STATUS_CHANGE',
      'REPORT_ACTIONED',
      'SETTING_UPDATE',
      'COUNTER_RECONCILE',
    ]),
    SettingVisibility: a.enum(['PUBLIC', 'INTERNAL']),

    /* =====================================================================
     * Reference data — no draft state, no PII. The only models that get a
     * direct guest read.
     * ===================================================================== */

    Category: a
      .model({
        slug: a.string().required(),
        nameHi: a.string().required(),
        nameEn: a.string().required(),
        descriptionHi: a.string(),
        descriptionEn: a.string(),
        displayOrder: a.integer().default(100),
        isActive: a.boolean().default(true),
        articles: a.hasMany('Article', 'categoryId'),
        publishedArticleCount: a
          .integer()
          .authorization((allow) => [
            allow.guest().to(['read']),
            allow.authenticated().to(['read']),
          ]),
      })
      .secondaryIndexes((index) => [
        index('slug').name('categoriesBySlug').queryField('categoryBySlug').projection('ALL'),
      ])
      .authorization((allow) => [
        allow.publicApiKey().to(['read']),
        allow.guest().to(['read']),
        allow.authenticated().to(['read']),
        allow.group('MODERATOR').to(['read']),
        allow.group('EDITOR').to(['create', 'read', 'update']),
        allow.group('ADMIN').to(['create', 'read', 'update', 'delete']),
      ])
      .disableOperations(['subscriptions']),

    Tag: a
      .model({
        slug: a.string().required(),
        nameHi: a.string().required(),
        nameEn: a.string().required(),
        isActive: a.boolean().default(true),
        articles: a.hasMany('ArticleTag', 'tagId'),
        publishedArticleCount: a
          .integer()
          .authorization((allow) => [
            allow.guest().to(['read']),
            allow.authenticated().to(['read']),
          ]),
      })
      .secondaryIndexes((index) => [
        index('slug').name('tagsBySlug').queryField('tagBySlug').projection('ALL'),
      ])
      .authorization((allow) => [
        allow.publicApiKey().to(['read']),
        allow.guest().to(['read']),
        allow.authenticated().to(['read']),
        allow.group('MODERATOR').to(['read']),
        allow.group('EDITOR').to(['create', 'read', 'update']),
        allow.group('ADMIN').to(['create', 'read', 'update', 'delete']),
      ])
      .disableOperations(['subscriptions']),

    /* =====================================================================
     * People
     * ===================================================================== */

    UserProfile: a
      .model({
        // id === the Cognito sub. Set by ensureUserProfile, never client-chosen.
        displayName: a.string().required(),
        bio: a.string(),
        avatarKey: a.string(),
        preferredLanguage: a.ref('Language'),
        // Optional by product requirement — never gate participation on these.
        state: a.string(),
        district: a.string(),
        notificationPreferences: a.json(),
        privacySettings: a.json(),
        isStaffAuthor: a.boolean().default(false),
        authorSlug: a.string(),

        // PII. Owner and admin only; never present in any public projection.
        email: a.email().authorization((allow) => [allow.owner(), allow.group(ADMIN)]),

        // Lambda-owned.
        isSuspended: a.boolean().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        suspendedUntil: a
          .datetime()
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        commentCount: a.integer().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        questionCount: a
          .integer()
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),

        articles: a.hasMany('Article', 'authorProfileId'),
        comments: a.hasMany('Comment', 'authorProfileId'),
        questions: a.hasMany('AudienceQuestion', 'askerProfileId'),
      })
      .secondaryIndexes((index) => [
        index('authorSlug').name('profilesByAuthorSlug').queryField('profileByAuthorSlug'),
      ])
      .authorization((allow) => [
        allow.owner().to(['read', 'update']),
        allow.groups(['EDITOR', 'MODERATOR']).to(['read']),
        allow.group('ADMIN').to(['read', 'update']),
      ])
      // Creation goes through ensureUserProfile so the id is always the
      // verified Cognito sub. Deletion is a compliance workflow, not a mutation.
      .disableOperations(['create', 'delete', 'subscriptions']),

    /* =====================================================================
     * Editorial
     * ===================================================================== */

    Article: a
      .model({
        slug: a.string().required(),
        language: a.ref('Language').required(),
        contentType: a.ref('ContentType').required(),

        title: a.string().required(),
        subtitle: a.string(),
        excerpt: a.string().required(),

        // Distinct editorial blocks. Keeping them separate in the data model
        // (rather than one body with conventions) is what makes the
        // fact/analysis/opinion separation structural instead of stylistic.
        factualSummary: a.string(), // "क्या हुआ"
        keyFacts: a.string().array(), // "ज़रूरी तथ्य"
        bodyMarkdown: a.string().required(),
        analysisMarkdown: a.string(), // "मेरा विश्लेषण"
        conclusionMarkdown: a.string(), // "मेरा निष्कर्ष"
        correctionNotice: a.string(),
        correctedAt: a.datetime(),

        // Derived at write time from the markdown.
        bodyPlain: a.string(),
        wordCount: a.integer(),
        readingMinutes: a.integer(),

        heroImageKey: a.string(),
        heroImageAlt: a.string(),
        heroImageCredit: a.string(),
        socialImageKey: a.string(),
        youtubeVideoId: a.string(),

        seoTitle: a.string(),
        seoDescription: a.string(),

        categoryId: a.id().required(),
        category: a.belongsTo('Category', 'categoryId'),
        tags: a.hasMany('ArticleTag', 'articleId'),
        authorProfileId: a.id().required(),
        author: a.belongsTo('UserProfile', 'authorProfileId'),
        // Denormalised so the feed GSI projection can stay small.
        authorDisplayName: a.string().required(),
        bylineOverride: a.string(),

        sources: a.hasMany('ArticleSource', 'articleId'),
        revisions: a.hasMany('ArticleRevision', 'articleId'),
        comments: a.hasMany('Comment', 'articleId'),
        polls: a.hasMany('Poll', 'articleId'),

        isFeatured: a.boolean().default(false),
        isBreaking: a.boolean().default(false),
        allowComments: a.boolean().default(true),
        scheduledFor: a.datetime(),

        // Editor-only. Never in a public projection, and unreadable outside staff.
        internalNotes: a.string().authorization((allow) => [allow.groups(MODERATORS)]),
        sourceContactNotes: a.string().authorization((allow) => [allow.groups(STAFF)]),

        // Declared explicitly because implicit Amplify timestamps cannot be
        // used as GSI sort keys. Every write path sets them: Lambda writes go
        // through amplifyItem(), and the admin data layer sets them on create.
        createdAt: a.datetime(),
        updatedAt: a.datetime(),

        // ---- LAMBDA-OWNED. `.to(['read'])` means no GraphQL mutation can
        // write these; publish-article sets them via scoped table IAM. This is
        // what makes `status` trustworthy enough to gate the public feed on.
        // NOT .required(): a required field that is also field-level
        // read-only cannot be written by any principal, so the row could
        // never be created. The write-lock is unchanged — only a Lambda
        // holding scoped table IAM sets this — and readers treat a missing
        // value as the safe default (DRAFT / PENDING), so it fails closed.
        status: a
          .ref('ArticleStatus')
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        feedKey: a // "PUBLISHED#HI"
          .string()
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        categoryFeedKey: a // "<categoryId>#PUBLISHED#HI"
          .string()
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        publishedAt: a.datetime().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        unpublishedAt: a
          .datetime()
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        lastVerifiedAt: a
          .datetime()
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        viewCount: a.integer().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        commentCount: a.integer().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        revisionCount: a
          .integer()
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
      })
      .secondaryIndexes((index) => [
        // The public feed. INCLUDE projection keeps items ~1KB so a 12-item
        // page costs ~2 RCU instead of dragging whole article bodies through.
        // `status` is in the projection because the resolver applies it as a
        // redundant filter — if it were missing, that filter would silently
        // match nothing and the feed would come back empty.
        index('feedKey')
          .sortKeys(['publishedAt'])
          .name('articlesByFeedKeyAndPublishedAt')
          .queryField(null)
          .projection('INCLUDE', [
            'slug',
            'title',
            'subtitle',
            'excerpt',
            'language',
            'contentType',
            'categoryId',
            'heroImageKey',
            'heroImageAlt',
            'authorDisplayName',
            'readingMinutes',
            'isBreaking',
            'isFeatured',
            'commentCount',
            'youtubeVideoId',
            'status',
          ]),
        index('categoryFeedKey')
          .sortKeys(['publishedAt'])
          .name('articlesByCategoryFeedKeyAndPublishedAt')
          .queryField(null)
          .projection('INCLUDE', [
            'slug',
            'title',
            'subtitle',
            'excerpt',
            'language',
            'contentType',
            'categoryId',
            'heroImageKey',
            'heroImageAlt',
            'authorDisplayName',
            'readingMinutes',
            'isBreaking',
            'isFeatured',
            'commentCount',
            'youtubeVideoId',
            'status',
          ]),
        // Slug lookup for the article detail page.
        index('slug').name('articlesBySlug').queryField(null).projection('ALL'),
        // Staff console: "my drafts", "everything in review".
        index('status')
          .sortKeys(['updatedAt'])
          .name('articlesByStatusAndUpdatedAt')
          .queryField('listArticlesByStatus')
          .projection('ALL'),
        index('authorProfileId')
          .sortKeys(['createdAt'])
          .name('articlesByAuthorAndCreatedAt')
          .queryField('listArticlesByAuthor')
          .projection('ALL'),
      ])
      // NOTE: no guest rule anywhere. See the header comment.
      .authorization((allow) => [
        allow.ownerDefinedIn('authorProfileId').to(['create', 'read', 'update']),
        allow.group('MODERATOR').to(['read']),
        allow.group('EDITOR').to(['create', 'read', 'update']),
        allow.group('ADMIN').to(['create', 'read', 'update', 'delete']),
      ])
      .disableOperations(['subscriptions']),

    ArticleSource: a
      .model({
        articleId: a.id().required(),
        article: a.belongsTo('Article', 'articleId'),
        title: a.string().required(),
        publisher: a.string(),
        url: a.url(),
        archiveUrl: a.url(),
        sourceKind: a.ref('SourceKind'),
        publishedAt: a.datetime(),
        accessedAt: a.datetime(),
        verificationNote: a.string(),
        displayOrder: a.integer().default(0),
      })
      .secondaryIndexes((index) => [
        index('articleId')
          .sortKeys(['displayOrder'])
          .name('articleSourcesByArticleAndOrder')
          .queryField(null)
          .projection('ALL'),
      ])
      // Public exposure is via the getPublishedArticleBySlug pipeline only —
      // a direct guest read here would leak the sources of an embargoed story.
      .authorization((allow) => [
        allow.group('MODERATOR').to(['read']),
        allow.groups(['ADMIN', 'EDITOR']).to(['create', 'read', 'update', 'delete']),
      ])
      .disableOperations(['subscriptions']),

    ArticleRevision: a
      .model({
        articleId: a.id().required(),
        article: a.belongsTo('Article', 'articleId'),
        revisionNumber: a.integer().required(),
        snapshot: a.json().required(),
        changeSummary: a.string(),
        statusAtRevision: a.ref('ArticleStatus'),
        changedBySub: a.string().required(),
        changedByName: a.string(),
      })
      .secondaryIndexes((index) => [
        index('articleId')
          .sortKeys(['revisionNumber'])
          .name('revisionsByArticleAndNumber')
          .queryField('listRevisionsByArticle')
          .projection('ALL'),
      ])
      .authorization((allow) => [allow.groups(MODERATORS).to(['read'])])
      // Immutable history, written only by publish-article.
      .disableOperations(['create', 'update', 'delete', 'subscriptions']),

    /** Slug-change redirects. Rows exist only for published articles, so a
     *  direct guest read is safe and saves a resolver on the 404 path. */
    ArticleRedirect: a
      .model({
        fromSlug: a.string().required(),
        toSlug: a.string().required(),
        contentType: a.ref('ContentType').required(),
        articleId: a.id().required(),
        // Declared explicitly because implicit Amplify timestamps cannot be
        // used as GSI sort keys. Every write path sets them: Lambda writes go
        // through amplifyItem(), and the admin data layer sets them on create.
        createdAt: a.datetime(),
      })
      .identifier(['fromSlug'])
      .secondaryIndexes((index) => [
        // Used by publish-article to collapse redirect chains to a single hop.
        index('articleId')
          .sortKeys(['createdAt'])
          .name('redirectsByArticleId')
          .queryField(null)
          .projection('ALL'),
      ])
      .authorization((allow) => [
        allow.publicApiKey().to(['read']),
        allow.guest().to(['read']),
        allow.authenticated().to(['read']),
        allow.groups(STAFF).to(['create', 'read', 'update', 'delete']),
      ])
      .disableOperations(['subscriptions']),

    ArticleTag: a
      .model({
        articleId: a.id().required(),
        tagId: a.id().required(),
        article: a.belongsTo('Article', 'articleId'),
        tag: a.belongsTo('Tag', 'tagId'),
        // "<tagId>#PUBLISHED#HI" — Lambda-owned, powers the public tag feed.
        tagFeedKey: a.string().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        publishedAt: a.datetime().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
      })
      // Composite PK makes the pairing unique by construction — a duplicate
      // tag on an article cannot be represented.
      .identifier(['articleId', 'tagId'])
      .secondaryIndexes((index) => [
        index('tagFeedKey')
          .sortKeys(['publishedAt'])
          .name('articleTagsByTagFeedKeyAndPublishedAt')
          .queryField(null)
          .projection('ALL'),
        index('tagId')
          .name('articleTagsByTagId')
          .queryField('listArticleTagsByTag')
          .projection('ALL'),
      ])
      .authorization((allow) => [
        allow.group('MODERATOR').to(['read']),
        allow.groups(['ADMIN', 'EDITOR']).to(['create', 'read', 'delete']),
      ])
      .disableOperations(['update', 'subscriptions']),

    /* =====================================================================
     * Janmat — polling
     * ===================================================================== */

    Poll: a
      .model({
        question: a.string().required(),
        description: a.string(),
        language: a.ref('Language').required(),
        articleId: a.id(),
        article: a.belongsTo('Article', 'articleId'),
        options: a.hasMany('PollOption', 'pollId'),

        allowVoteChange: a.boolean().default(false),
        maxVoteChanges: a.integer().default(1),
        showResultsBeforeVoting: a.boolean().default(false),
        requestExplanation: a.boolean().default(false),
        opensAt: a.datetime(),
        closesAt: a.datetime(),
        isDaily: a.boolean().default(false),

        // NOT .required(): a required field that is also field-level
        // read-only cannot be written by any principal, so the row could
        // never be created. The write-lock is unchanged — only a Lambda
        // holding scoped table IAM sets this — and readers treat a missing
        // value as the safe default (DRAFT / PENDING), so it fails closed.
        status: a
          .ref('PollStatus')
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        totalVotes: a.integer().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        lastReconciledAt: a.datetime().authorization((allow) => [allow.group(ADMIN).to(['read'])]),
      })
      .secondaryIndexes((index) => [
        index('status')
          .sortKeys(['closesAt'])
          .name('pollsByStatusAndClosesAt')
          .queryField('listPollsByStatus')
          .projection('ALL'),
      ])
      .authorization((allow) => [
        allow.group('MODERATOR').to(['read']),
        allow.group('EDITOR').to(['create', 'read', 'update']),
        allow.group('ADMIN').to(['create', 'read', 'update', 'delete']),
      ])
      .disableOperations(['subscriptions']),

    PollOption: a
      .model({
        pollId: a.id().required(),
        poll: a.belongsTo('Poll', 'pollId'),
        label: a.string().required(),
        description: a.string(),
        displayOrder: a.integer().required(),
        voteCount: a.integer().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
      })
      .secondaryIndexes((index) => [
        index('pollId')
          .sortKeys(['displayOrder'])
          .name('pollOptionsByPollIdAndDisplayOrder')
          .queryField(null)
          .projection('ALL'),
      ])
      .authorization((allow) => [
        allow.group('MODERATOR').to(['read']),
        allow.group('EDITOR').to(['create', 'read', 'update']),
        allow.group('ADMIN').to(['create', 'read', 'update', 'delete']),
      ])
      .disableOperations(['subscriptions']),

    /**
     * One vote per user per poll is a property of the PRIMARY KEY:
     * id = `${pollId}#${userSub}`, enforced by a DynamoDB conditional write.
     * Not by application logic, not by a GSI, and not by a read-then-write.
     *
     * Every GraphQL operation is disabled. That is how "individual users'
     * votes must never be publicly readable" is satisfied — there is no query
     * to call, no filter to get wrong, and no auth rule to regress.
     */
    Vote: a
      .model({
        pollId: a.id().required(),
        pollOptionId: a.id().required(),
        userSub: a.string().required(),
        explanation: a.string(),
        changeCount: a.integer().default(0),
        ipHash: a.string(),
        castAt: a.datetime().required(),
      })
      .secondaryIndexes((index) => [
        index('pollId')
          .sortKeys(['castAt'])
          .name('votesByPollIdAndCastAt')
          .queryField(null)
          .projection('KEYS_ONLY'),
        index('pollOptionId')
          .sortKeys(['castAt'])
          .name('votesByPollOptionIdAndCastAt')
          .queryField(null)
          .projection('KEYS_ONLY'),
        index('userSub')
          .sortKeys(['castAt'])
          .name('votesByUserSubAndCastAt')
          .queryField(null)
          .projection('ALL'),
      ])
      .authorization((allow) => [allow.group(ADMIN).to(['read'])])
      .disableOperations(['queries', 'mutations', 'subscriptions']),

    /* =====================================================================
     * Ask Amrit
     * ===================================================================== */

    AudienceQuestion: a
      .model({
        questionText: a.string().required(),
        category: a.string(),
        language: a.ref('Language').required(),
        articleId: a.id(),
        liveEventId: a.id(),
        askerProfileId: a.id().required(),
        asker: a.belongsTo('UserProfile', 'askerProfileId'),
        askerDisplayName: a.string().required(),

        writtenAnswer: a.string(),
        answerVideoUrl: a.url(),
        answeredAt: a.datetime(),
        answeredBySub: a.string(),
        editorNotes: a.string().authorization((allow) => [allow.groups(MODERATORS)]),

        // Declared explicitly because implicit Amplify timestamps cannot be
        // used as GSI sort keys. Every write path sets them: Lambda writes go
        // through amplifyItem(), and the admin data layer sets them on create.
        createdAt: a.datetime(),

        // NOT .required(): a required field that is also field-level
        // read-only cannot be written by any principal, so the row could
        // never be created. The write-lock is unchanged — only a Lambda
        // holding scoped table IAM sets this — and readers treat a missing
        // value as the safe default (DRAFT / PENDING), so it fails closed.
        status: a
          .ref('QuestionStatus')
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        // "<scope>#APPROVED" — a sparse GSI partition. Rejecting a question
        // REMOVES this attribute, so the row leaves the index entirely rather
        // than being filtered out of it.
        queueKey: a.string().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        upvoteCount: a.integer().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        moderationNote: a
          .string()
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        ipHash: a.string().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
      })
      .secondaryIndexes((index) => [
        index('queueKey')
          .sortKeys(['upvoteCount'])
          .name('questionsByQueueKeyAndUpvoteCount')
          .queryField(null)
          .projection('ALL'),
        index('status')
          .sortKeys(['createdAt'])
          .name('questionsByStatusAndCreatedAt')
          .queryField('listQuestionsByStatus')
          .projection('ALL'),
        index('askerProfileId')
          .sortKeys(['createdAt'])
          .name('questionsByAskerAndCreatedAt')
          .queryField('listQuestionsByAsker')
          .projection('ALL'),
      ])
      .authorization((allow) => [
        allow.ownerDefinedIn('askerProfileId').to(['read', 'delete']),
        allow.groups(MODERATORS).to(['read', 'update', 'delete']),
      ])
      // Creation goes through submitQuestion (rate limit, ipHash, PENDING).
      .disableOperations(['create', 'subscriptions']),

    QuestionUpvote: a
      .model({
        // id = `${questionId}#${userSub}`
        questionId: a.id().required(),
        userSub: a.string().required(),
        votedAt: a.datetime().required(),
        ipHash: a.string(),
      })
      .secondaryIndexes((index) => [
        index('questionId')
          .sortKeys(['votedAt'])
          .name('upvotesByQuestionIdAndVotedAt')
          .queryField(null)
          .projection('KEYS_ONLY'),
        index('userSub')
          .sortKeys(['votedAt'])
          .name('upvotesByUserSubAndVotedAt')
          .queryField(null)
          .projection('ALL'),
      ])
      .authorization((allow) => [allow.group(ADMIN).to(['read'])])
      .disableOperations(['queries', 'mutations', 'subscriptions']),

    /* =====================================================================
     * Comments
     * ===================================================================== */

    Comment: a
      .model({
        articleId: a.id().required(),
        article: a.belongsTo('Article', 'articleId'),
        parentCommentId: a.id(),
        parent: a.belongsTo('Comment', 'parentCommentId'),
        replies: a.hasMany('Comment', 'parentCommentId'),

        authorProfileId: a.id().required(),
        author: a.belongsTo('UserProfile', 'authorProfileId'),
        authorDisplayName: a.string().required(),
        // Plain text only. No markdown, no HTML — the UGC XSS surface is
        // removed by construction rather than by filtering.
        content: a.string().required(),
        depth: a.integer().default(0),

        // Declared explicitly because implicit Amplify timestamps cannot be
        // used as GSI sort keys. Every write path sets them: Lambda writes go
        // through amplifyItem(), and the admin data layer sets them on create.
        createdAt: a.datetime(),

        // NOT .required(): a required field that is also field-level
        // read-only cannot be written by any principal, so the row could
        // never be created. The write-lock is unchanged — only a Lambda
        // holding scoped table IAM sets this — and readers treat a missing
        // value as the safe default (DRAFT / PENDING), so it fails closed.
        status: a
          .ref('CommentStatus')
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        // "<articleId>#APPROVED" — sparse. Hiding a comment removes the
        // attribute, so it is absent from the index, not filtered out of it.
        threadKey: a.string().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        reportCount: a.integer().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        moderationNote: a
          .string()
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        moderatedBySub: a
          .string()
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        moderatedAt: a.datetime().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        ipHash: a.string().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        contentHash: a.string().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
      })
      .secondaryIndexes((index) => [
        index('threadKey')
          .sortKeys(['createdAt'])
          .name('commentsByThreadKeyAndCreatedAt')
          .queryField(null)
          .projection('ALL'),
        index('status')
          .sortKeys(['createdAt'])
          .name('commentsByStatusAndCreatedAt')
          .queryField('listCommentsByStatus')
          .projection('ALL'),
        index('authorProfileId')
          .sortKeys(['createdAt'])
          .name('commentsByAuthorAndCreatedAt')
          .queryField('listCommentsByAuthor')
          .projection('ALL'),
      ])
      .authorization((allow) => [
        allow.ownerDefinedIn('authorProfileId').to(['read', 'delete']),
        allow.groups(MODERATORS).to(['read', 'update', 'delete']),
      ])
      .disableOperations(['create', 'subscriptions']),

    ContentReport: a
      .model({
        targetType: a.ref('ModerationTarget').required(),
        targetId: a.id().required(),
        reportedBySub: a.string().required(),
        reason: a.ref('ReportReason').required(),
        details: a.string(),
        // Declared explicitly because implicit Amplify timestamps cannot be
        // used as GSI sort keys. Every write path sets them: Lambda writes go
        // through amplifyItem(), and the admin data layer sets them on create.
        createdAt: a.datetime(),
        // NOT .required(): a required field that is also field-level
        // read-only cannot be written by any principal, so the row could
        // never be created. The write-lock is unchanged — only a Lambda
        // holding scoped table IAM sets this — and readers treat a missing
        // value as the safe default (DRAFT / PENDING), so it fails closed.
        status: a
          .ref('ReportStatus')
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        reviewedBySub: a.string().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        reviewedAt: a.datetime().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        resolutionNote: a
          .string()
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        ipHash: a.string().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
      })
      .secondaryIndexes((index) => [
        index('targetId')
          .sortKeys(['createdAt'])
          .name('reportsByTargetAndCreatedAt')
          .queryField(null)
          .projection('ALL'),
        index('status')
          .sortKeys(['createdAt'])
          .name('reportsByStatusAndCreatedAt')
          .queryField('listReportsByStatus')
          .projection('ALL'),
      ])
      .authorization((allow) => [
        allow.ownerDefinedIn('reportedBySub').to(['read']),
        allow.groups(MODERATORS).to(['read', 'update']),
      ])
      .disableOperations(['create', 'delete', 'subscriptions']),

    /* =====================================================================
     * Live events
     * ===================================================================== */

    LiveEvent: a
      .model({
        slug: a.string().required(),
        title: a.string().required(),
        description: a.string(),
        language: a.ref('Language').required(),
        coverImageKey: a.string(),
        youtubeLiveUrl: a.url(),
        replayUrl: a.url(),
        startsAt: a.datetime().required(),
        endsAt: a.datetime(),
        registrationEnabled: a.boolean().default(true),
        relatedArticleId: a.id(),

        // NOT .required(): a required field that is also field-level
        // read-only cannot be written by any principal, so the row could
        // never be created. The write-lock is unchanged — only a Lambda
        // holding scoped table IAM sets this — and readers treat a missing
        // value as the safe default (DRAFT / PENDING), so it fails closed.
        status: a
          .ref('LiveEventStatus')
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        // "PUBLIC#<language>" — sparse; DRAFT and CANCELLED rows have no key.
        feedKey: a.string().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
        registrationCount: a
          .integer()
          .authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),
      })
      .secondaryIndexes((index) => [
        index('feedKey')
          .sortKeys(['startsAt'])
          .name('eventsByFeedKeyAndStartsAt')
          .queryField(null)
          .projection('ALL'),
        index('slug').name('eventsBySlug').queryField(null).projection('ALL'),
        index('status')
          .sortKeys(['startsAt'])
          .name('eventsByStatusAndStartsAt')
          .queryField('listEventsByStatus')
          .projection('ALL'),
      ])
      .authorization((allow) => [
        allow.group('MODERATOR').to(['read']),
        allow.group('EDITOR').to(['create', 'read', 'update']),
        allow.group('ADMIN').to(['create', 'read', 'update', 'delete']),
      ])
      .disableOperations(['subscriptions']),

    EventRegistration: a
      .model({
        eventId: a.id().required(),
        userSub: a.string().required(),
        displayName: a.string(),
        registeredAt: a.datetime().required(),
        attended: a.boolean().default(false),
      })
      // Composite PK — registering twice is not representable.
      //
      // userSub is the PARTITION key, not the sort key, and that ordering is
      // forced: Amplify rejects a composite sort key that is also an owner
      // @auth field. It also happens to be the better shape, because "my
      // registered events" is then a direct table Query with no index.
      .identifier(['userSub', 'eventId'])
      .secondaryIndexes((index) => [
        // The inverse lookup, for the admin attendee list.
        index('eventId')
          .sortKeys(['registeredAt'])
          .name('registrationsByEventIdAndRegisteredAt')
          .queryField('listRegistrationsByEvent')
          .projection('ALL'),
      ])
      .authorization((allow) => [
        allow.ownerDefinedIn('userSub'),
        allow.groups(MODERATORS).to(['read']),
      ])
      .disableOperations(['subscriptions']),

    /* =====================================================================
     * Promise tracker
     * ===================================================================== */

    PromiseTrackerEntry: a
      .model({
        slug: a.string().required(),
        title: a.string().required(),
        politician: a.string().required(),
        organisation: a.string(),
        party: a.string().required(),
        state: a.string(),
        constituency: a.string(),
        topic: a.string(),
        language: a.ref('Language').required(),

        promiseText: a.string().required(),
        dateMade: a.date(),
        targetDate: a.date(),
        sourceUrl: a.url(),
        // Requirement: the reader must be able to see HOW the status was
        // decided, not just what it is.
        assessment: a.string(),
        assessmentMethod: a.string(),
        evidenceKeys: a.string().array(),
        evidenceUrls: a.string().array(),
        lastVerifiedAt: a.datetime(),

        status: a.ref('PromiseStatus').required(),
        isPublished: a.boolean().default(false),
        // "PUBLIC#<language>" — sparse, so unpublished entries are absent.
        publicKey: a.string().authorization((allow) => [allow.groups(MODERATORS).to(['read'])]),

        statusChanges: a.hasMany('PromiseStatusChange', 'promiseId'),
        createdBySub: a.string(),
      })
      .secondaryIndexes((index) => [
        index('publicKey')
          .sortKeys(['dateMade'])
          .name('promisesByPublicKeyAndDateMade')
          .queryField(null)
          .projection('ALL'),
        index('slug').name('promisesBySlug').queryField(null).projection('ALL'),
        index('status')
          .sortKeys(['targetDate'])
          .name('promisesByStatusAndTargetDate')
          .queryField('listPromisesByStatus')
          .projection('ALL'),
        index('party')
          .sortKeys(['dateMade'])
          .name('promisesByPartyAndDateMade')
          .queryField('listPromisesByParty')
          .projection('ALL'),
      ])
      .authorization((allow) => [
        allow.group('MODERATOR').to(['read']),
        allow.group('EDITOR').to(['create', 'read', 'update']),
        allow.group('ADMIN').to(['create', 'read', 'update', 'delete']),
      ])
      .disableOperations(['subscriptions']),

    PromiseStatusChange: a
      .model({
        promiseId: a.id().required(),
        promise: a.belongsTo('PromiseTrackerEntry', 'promiseId'),
        fromStatus: a.ref('PromiseStatus'),
        toStatus: a.ref('PromiseStatus').required(),
        rationale: a.string().required(),
        evidenceUrls: a.string().array(),
        changedBySub: a.string().required(),
        changedByName: a.string(),
        // Declared explicitly because implicit Amplify timestamps cannot be
        // used as GSI sort keys. Every write path sets them: Lambda writes go
        // through amplifyItem(), and the admin data layer sets them on create.
        createdAt: a.datetime(),
      })
      .secondaryIndexes((index) => [
        index('promiseId')
          .sortKeys(['createdAt'])
          .name('statusChangesByPromiseAndCreatedAt')
          .queryField(null)
          .projection('ALL'),
      ])
      .authorization((allow) => [
        allow.group('MODERATOR').to(['read']),
        allow.groups(['ADMIN', 'EDITOR']).to(['create', 'read']),
      ])
      .disableOperations(['update', 'delete', 'subscriptions']),

    /* =====================================================================
     * Member data
     * ===================================================================== */

    SavedArticle: a
      .model({
        userSub: a.string().required(),
        articleId: a.id().required(),
        savedAt: a.datetime().required(),
        note: a.string(),
      })
      // Composite PK — saving twice is idempotent by construction.
      .identifier(['userSub', 'articleId'])
      .authorization((allow) => [allow.ownerDefinedIn('userSub')])
      .disableOperations(['subscriptions']),

    /* =====================================================================
     * Newsletter
     * ===================================================================== */

    /**
     * id = sha256(lower(trim(email))). Three consequences, all deliberate:
     * subscribe is naturally idempotent; there is NO index on email, so no
     * query can enumerate subscribers; and the unsubscribe link carries the
     * hash rather than the address.
     */
    NewsletterSubscription: a
      .model({
        email: a.email().required(),
        language: a.ref('Language').required(),
        status: a.ref('SubscriptionStatus').required(),
        source: a.string(),
        // Only the HASH of the verification token is ever persisted.
        tokenHash: a.string(),
        tokenExpiresAt: a.datetime(),
        consentAt: a.datetime(),
        consentIpHash: a.string(),
        verifiedAt: a.datetime(),
        unsubscribedAt: a.datetime(),
        bounceType: a.string(),
        attemptCount: a.integer().default(0),
        // Declared explicitly because implicit Amplify timestamps cannot be
        // used as GSI sort keys. Every write path sets them: Lambda writes go
        // through amplifyItem(), and the admin data layer sets them on create.
        createdAt: a.datetime(),
      })
      .secondaryIndexes((index) => [
        index('status')
          .sortKeys(['createdAt'])
          .name('subscriptionsByStatusAndCreatedAt')
          .queryField(null)
          .projection('KEYS_ONLY'),
      ])
      // No owner rule: a subscriber is not an authenticated principal.
      .authorization((allow) => [allow.group(ADMIN).to(['read'])])
      .disableOperations(['queries', 'mutations', 'subscriptions']),

    /* =====================================================================
     * Operations
     * ===================================================================== */

    AuditLog: a
      .model({
        action: a.ref('AuditAction').required(),
        actorSub: a.string().required(),
        actorUsername: a.string(),
        actorGroups: a.string().array(),
        targetType: a.string(),
        targetId: a.string(),
        beforeJson: a.string(),
        afterJson: a.string(),
        reason: a.string(),
        // Hashed, never raw. See amplify/functions/shared/hash.ts.
        sourceIpHash: a.string(),
        at: a.datetime().required(),
      })
      .secondaryIndexes((index) => [
        index('actorSub')
          .sortKeys(['at'])
          .name('auditByActorAndAt')
          .queryField('listAuditByActor')
          .projection('ALL'),
        index('targetId')
          .sortKeys(['at'])
          .name('auditByTargetAndAt')
          .queryField('listAuditByTarget')
          .projection('ALL'),
        index('action')
          .sortKeys(['at'])
          .name('auditByActionAndAt')
          .queryField('listAuditByAction')
          .projection('ALL'),
      ])
      .authorization((allow) => [allow.group(ADMIN).to(['read'])])
      // Append-only, written only by Lambdas holding scoped table IAM.
      .disableOperations(['mutations', 'subscriptions']),

    AnalyticsEvent: a
      .model({
        eventType: a.string().required(),
        articleId: a.id(),
        entityId: a.string(),
        sessionHash: a.string(),
        language: a.string(),
        referrerHost: a.string(),
        at: a.datetime().required(),
        // TTL attribute, configured on the table in backend.ts.
        expiresAt: a.integer(),
      })
      .secondaryIndexes((index) => [
        index('eventType')
          .sortKeys(['at'])
          .name('analyticsByTypeAndAt')
          .queryField(null)
          .projection('ALL'),
        index('articleId')
          .sortKeys(['at'])
          .name('analyticsByArticleAndAt')
          .queryField(null)
          .projection('KEYS_ONLY'),
      ])
      .authorization((allow) => [allow.group(ADMIN).to(['read'])])
      .disableOperations(['queries', 'subscriptions']),

    /** Denormalised search index, written by publish-article. */
    SearchDocument: a
      .model({
        entityType: a.string().required(),
        entityId: a.string().required(),
        slug: a.string().required(),
        title: a.string().required(),
        excerpt: a.string(),
        language: a.ref('Language').required(),
        contentType: a.string(),
        categoryId: a.id(),
        heroImageKey: a.string(),
        authorDisplayName: a.string(),
        readingMinutes: a.integer(),
        publishedAt: a.datetime(),
        // Normalised via the SHARED devanagari module — the write path and the
        // query path must produce byte-identical output or indexed documents
        // become unreachable.
        titleNorm: a.string(),
        bodyNorm: a.string(),
        tokens: a.string().array(),
        // "<entityType>#<language>"
        searchKey: a.string(),
        popularityScore: a.integer().default(0),
      })
      .secondaryIndexes((index) => [
        index('searchKey')
          .sortKeys(['publishedAt'])
          .name('searchByKeyAndPublishedAt')
          .queryField(null)
          .projection('ALL'),
      ])
      .authorization((allow) => [allow.group(ADMIN).to(['read'])])
      .disableOperations(['queries', 'mutations', 'subscriptions']),

    /** Inverted index for multi-term search. One row per (token, document). */
    SearchToken: a
      .model({
        token: a.string().required(),
        // "<inverted-epoch>#<documentId>" so a plain Query returns newest-first
        // with no sort-key expression.
        docSort: a.string().required(),
        documentId: a.string().required(),
        entityType: a.string().required(),
        language: a.string().required(),
      })
      .identifier(['token', 'docSort'])
      .authorization((allow) => [allow.group(ADMIN).to(['read'])])
      .disableOperations(['queries', 'mutations', 'subscriptions']),

    /**
     * Breaking-news strip, featured content, moderation policy.
     * The public resolver hard-codes `visibility = 'PUBLIC'` as the partition
     * key, so an INTERNAL setting (moderation thresholds, banned-word lists)
     * cannot be reached even by guessing its key.
     */
    SiteSetting: a
      .model({
        settingKey: a.string().required(),
        visibility: a.ref('SettingVisibility').required(),
        valueJson: a.json().required(),
        description: a.string(),
        updatedBySub: a.string(),
      })
      .identifier(['settingKey'])
      .secondaryIndexes((index) => [
        index('visibility').name('settingsByVisibility').queryField(null).projection('ALL'),
      ])
      .authorization((allow) => [
        allow.groups(['EDITOR', 'MODERATOR']).to(['read']),
        allow.group('ADMIN').to(['create', 'read', 'update', 'delete']),
      ])
      .disableOperations(['subscriptions']),

    /* =====================================================================
     * Public projection types
     *
     * These have no model auth rules, so they inherit the operation's
     * authorization and cannot suffer the type-level directive mismatch a
     * guest hits when a custom query returns `a.ref('Article')`.
     *
     * They are also a permanent field allowlist: a future developer who adds
     * a sensitive field to `Article` cannot leak it through the public feed
     * without also adding it here.
     * ===================================================================== */

    PublicArticleCard: a.customType({
      id: a.id().required(),
      slug: a.string().required(),
      title: a.string().required(),
      subtitle: a.string(),
      excerpt: a.string(),
      language: a.string(),
      contentType: a.string(),
      categoryId: a.id(),
      heroImageKey: a.string(),
      heroImageAlt: a.string(),
      authorDisplayName: a.string(),
      publishedAt: a.datetime(),
      readingMinutes: a.integer(),
      isBreaking: a.boolean(),
      isFeatured: a.boolean(),
      commentCount: a.integer(),
      youtubeVideoId: a.string(),
    }),

    PublicArticleConnection: a.customType({
      items: a.ref('PublicArticleCard').required().array().required(),
      nextToken: a.string(),
    }),

    PublicArticleSource: a.customType({
      id: a.id().required(),
      title: a.string().required(),
      publisher: a.string(),
      url: a.string(),
      archiveUrl: a.string(),
      sourceKind: a.string(),
      publishedAt: a.datetime(),
      accessedAt: a.datetime(),
      verificationNote: a.string(),
      displayOrder: a.integer(),
    }),

    PublicArticle: a.customType({
      id: a.id().required(),
      slug: a.string().required(),
      title: a.string().required(),
      subtitle: a.string(),
      excerpt: a.string(),
      language: a.string(),
      contentType: a.string(),
      categoryId: a.id(),
      factualSummary: a.string(),
      keyFacts: a.string().array(),
      bodyMarkdown: a.string(),
      analysisMarkdown: a.string(),
      conclusionMarkdown: a.string(),
      correctionNotice: a.string(),
      correctedAt: a.datetime(),
      heroImageKey: a.string(),
      heroImageAlt: a.string(),
      heroImageCredit: a.string(),
      socialImageKey: a.string(),
      youtubeVideoId: a.string(),
      seoTitle: a.string(),
      seoDescription: a.string(),
      authorProfileId: a.id(),
      authorDisplayName: a.string(),
      bylineOverride: a.string(),
      readingMinutes: a.integer(),
      wordCount: a.integer(),
      publishedAt: a.datetime(),
      updatedAt: a.datetime(),
      lastVerifiedAt: a.datetime(),
      isBreaking: a.boolean(),
      allowComments: a.boolean(),
      commentCount: a.integer(),
      sources: a.ref('PublicArticleSource').array(),
    }),

    PublicPollOption: a.customType({
      id: a.id().required(),
      label: a.string().required(),
      description: a.string(),
      displayOrder: a.integer(),
      voteCount: a.integer(),
    }),

    PublicPoll: a.customType({
      id: a.id().required(),
      question: a.string().required(),
      description: a.string(),
      language: a.string(),
      status: a.string(),
      articleId: a.id(),
      totalVotes: a.integer(),
      allowVoteChange: a.boolean(),
      showResultsBeforeVoting: a.boolean(),
      requestExplanation: a.boolean(),
      opensAt: a.datetime(),
      closesAt: a.datetime(),
      options: a.ref('PublicPollOption').array(),
    }),

    PublicComment: a.customType({
      id: a.id().required(),
      articleId: a.id().required(),
      parentCommentId: a.id(),
      authorProfileId: a.id(),
      authorDisplayName: a.string().required(),
      content: a.string().required(),
      depth: a.integer(),
      createdAt: a.datetime(),
    }),

    PublicCommentConnection: a.customType({
      items: a.ref('PublicComment').required().array().required(),
      nextToken: a.string(),
    }),

    PublicQuestion: a.customType({
      id: a.id().required(),
      questionText: a.string().required(),
      category: a.string(),
      language: a.string(),
      articleId: a.id(),
      liveEventId: a.id(),
      askerDisplayName: a.string().required(),
      status: a.string(),
      upvoteCount: a.integer(),
      writtenAnswer: a.string(),
      answerVideoUrl: a.string(),
      answeredAt: a.datetime(),
      createdAt: a.datetime(),
    }),

    PublicQuestionConnection: a.customType({
      items: a.ref('PublicQuestion').required().array().required(),
      nextToken: a.string(),
    }),

    PublicLiveEvent: a.customType({
      id: a.id().required(),
      slug: a.string().required(),
      title: a.string().required(),
      description: a.string(),
      language: a.string(),
      status: a.string(),
      coverImageKey: a.string(),
      youtubeLiveUrl: a.string(),
      replayUrl: a.string(),
      startsAt: a.datetime(),
      endsAt: a.datetime(),
      registrationEnabled: a.boolean(),
      registrationCount: a.integer(),
      relatedArticleId: a.id(),
    }),

    PublicLiveEventConnection: a.customType({
      items: a.ref('PublicLiveEvent').required().array().required(),
      nextToken: a.string(),
    }),

    PublicSiteSetting: a.customType({
      settingKey: a.string().required(),
      valueJson: a.json(),
    }),

    /* ---- Mutation results ---- */

    VoteResult: a.customType({
      ok: a.boolean().required(),
      // OK | ALREADY_VOTED | POLL_CLOSED | INVALID_OPTION | RATE_LIMITED | ...
      code: a.string().required(),
      message: a.string(),
      pollId: a.id(),
      pollOptionId: a.id(),
      totalVotes: a.integer(),
      changed: a.boolean(),
    }),

    UpvoteResult: a.customType({
      ok: a.boolean().required(),
      code: a.string().required(),
      message: a.string(),
      questionId: a.id(),
      upvoted: a.boolean(),
      upvoteCount: a.integer(),
    }),

    SubmissionResult: a.customType({
      ok: a.boolean().required(),
      code: a.string().required(),
      message: a.string(),
      id: a.id(),
      status: a.string(),
    }),

    ModerationResult: a.customType({
      ok: a.boolean().required(),
      code: a.string().required(),
      message: a.string(),
      targetId: a.id(),
      newStatus: a.string(),
    }),

    GenericResult: a.customType({
      ok: a.boolean().required(),
      code: a.string().required(),
      message: a.string(),
    }),

    PublishResult: a.customType({
      ok: a.boolean().required(),
      code: a.string().required(),
      message: a.string(),
      articleId: a.id(),
      status: a.string(),
      slug: a.string(),
      revisionNumber: a.integer(),
    }),

    ReconcileResult: a.customType({
      ok: a.boolean().required(),
      code: a.string().required(),
      message: a.string(),
      scanned: a.integer(),
      corrected: a.integer(),
      cursor: a.string(),
      done: a.boolean(),
    }),

    SearchResultItem: a.customType({
      entityType: a.string().required(),
      entityId: a.string().required(),
      slug: a.string().required(),
      title: a.string().required(),
      excerpt: a.string(),
      language: a.string(),
      contentType: a.string(),
      heroImageKey: a.string(),
      authorDisplayName: a.string(),
      publishedAt: a.datetime(),
      score: a.integer(),
    }),

    SearchResults: a.customType({
      items: a.ref('SearchResultItem').required().array().required(),
      nextToken: a.string(),
      totalScanned: a.integer(),
    }),

    /* =====================================================================
     * PUBLIC READS — APPSYNC_JS resolvers. Zero Lambda, zero cold start.
     *
     * Every one needs all three auth rules: allow.guest() covers only the
     * identity-pool UNAUTH role, so a signed-in reader on identity-pool
     * credentials (auth role) would otherwise be rejected from public content.
     * ===================================================================== */

    listPublishedArticles: a
      .query()
      .arguments({
        language: a.string(),
        contentType: a.string(),
        limit: a.integer(),
        nextToken: a.string(),
      })
      .returns(a.ref('PublicArticleConnection'))
      .authorization((allow) => [allow.publicApiKey(), allow.authenticated()])
      .handler(
        a.handler.custom({
          entry: './resolvers/list-published-articles.js',
          dataSource: a.ref('Article'),
        }),
      ),

    listPublishedArticlesByCategory: a
      .query()
      .arguments({
        categoryId: a.id().required(),
        language: a.string(),
        limit: a.integer(),
        nextToken: a.string(),
      })
      .returns(a.ref('PublicArticleConnection'))
      .authorization((allow) => [allow.publicApiKey(), allow.authenticated()])
      .handler(
        a.handler.custom({
          entry: './resolvers/list-published-articles-by-category.js',
          dataSource: a.ref('Article'),
        }),
      ),

    listPublishedArticlesByTag: a
      .query()
      .arguments({
        tagId: a.id().required(),
        language: a.string(),
        limit: a.integer(),
        nextToken: a.string(),
      })
      .returns(a.ref('PublicArticleConnection'))
      // Lambda-backed, so identity-pool guest auth IS available here and no
      // API key is involved.
      .authorization((allow) => [
        allow.guest(),
        allow.authenticated('identityPool'),
        allow.authenticated(),
      ])
      // Two stages: the sparse join-table index resolves ids, then one
      // BatchGetItem turns them into cards. Two requests total, whatever the
      // page size.
      .handler(a.handler.function(listArticlesByTag)),

    /** Two-stage pipeline: the article, then its sources. */
    getPublishedArticleBySlug: a
      .query()
      .arguments({ slug: a.string().required() })
      .returns(a.ref('PublicArticle'))
      .authorization((allow) => [allow.publicApiKey(), allow.authenticated()])
      .handler([
        a.handler.custom({
          entry: './resolvers/get-published-article-1-article.js',
          dataSource: a.ref('Article'),
        }),
        a.handler.custom({
          entry: './resolvers/get-published-article-2-sources.js',
          dataSource: a.ref('ArticleSource'),
        }),
      ]),

    getPublicPoll: a
      .query()
      .arguments({ pollId: a.id().required() })
      .returns(a.ref('PublicPoll'))
      .authorization((allow) => [allow.publicApiKey(), allow.authenticated()])
      .handler([
        a.handler.custom({
          entry: './resolvers/get-public-poll-1-poll.js',
          dataSource: a.ref('Poll'),
        }),
        a.handler.custom({
          entry: './resolvers/get-public-poll-2-options.js',
          dataSource: a.ref('PollOption'),
        }),
      ]),

    listApprovedComments: a
      .query()
      .arguments({
        articleId: a.id().required(),
        limit: a.integer(),
        nextToken: a.string(),
      })
      .returns(a.ref('PublicCommentConnection'))
      .authorization((allow) => [allow.publicApiKey(), allow.authenticated()])
      .handler(
        a.handler.custom({
          entry: './resolvers/list-approved-comments.js',
          dataSource: a.ref('Comment'),
        }),
      ),

    listApprovedQuestions: a
      .query()
      .arguments({
        scope: a.string(),
        limit: a.integer(),
        nextToken: a.string(),
      })
      .returns(a.ref('PublicQuestionConnection'))
      .authorization((allow) => [allow.publicApiKey(), allow.authenticated()])
      .handler(
        a.handler.custom({
          entry: './resolvers/list-approved-questions.js',
          dataSource: a.ref('AudienceQuestion'),
        }),
      ),

    listPublicLiveEvents: a
      .query()
      .arguments({
        language: a.string(),
        limit: a.integer(),
        nextToken: a.string(),
      })
      .returns(a.ref('PublicLiveEventConnection'))
      .authorization((allow) => [allow.publicApiKey(), allow.authenticated()])
      .handler(
        a.handler.custom({
          entry: './resolvers/list-public-live-events.js',
          dataSource: a.ref('LiveEvent'),
        }),
      ),

    getPublicSiteSettings: a
      .query()
      .returns(a.ref('PublicSiteSetting').array())
      .authorization((allow) => [allow.publicApiKey(), allow.authenticated()])
      .handler(
        a.handler.custom({
          entry: './resolvers/get-public-site-settings.js',
          dataSource: a.ref('SiteSetting'),
        }),
      ),

    /* =====================================================================
     * WRITES — Lambda. Anything needing secrets, SES, transactions, or code
     * shared with other paths (APPSYNC_JS resolvers cannot import modules).
     * ===================================================================== */

    castVote: a
      .mutation()
      .arguments({
        pollId: a.id().required(),
        pollOptionId: a.id().required(),
        explanation: a.string(),
      })
      .returns(a.ref('VoteResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(castVote)),

    toggleQuestionUpvote: a
      .mutation()
      // A desired STATE, not a toggle: a blind toggle is not idempotent, and a
      // double-tap or client retry would silently invert the result.
      .arguments({ questionId: a.id().required(), upvoted: a.boolean().required() })
      .returns(a.ref('UpvoteResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(toggleQuestionUpvote)),

    submitComment: a
      .mutation()
      .arguments({
        articleId: a.id().required(),
        parentCommentId: a.id(),
        content: a.string().required(),
      })
      .returns(a.ref('SubmissionResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitComment)),

    submitQuestion: a
      .mutation()
      .arguments({
        questionText: a.string().required(),
        category: a.string(),
        articleId: a.id(),
        liveEventId: a.id(),
      })
      .returns(a.ref('SubmissionResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitQuestion)),

    submitReport: a
      .mutation()
      .arguments({
        targetType: a.string().required(),
        targetId: a.id().required(),
        reason: a.string().required(),
        details: a.string(),
      })
      .returns(a.ref('SubmissionResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitReport)),

    ensureUserProfile: a
      .mutation()
      .arguments({ displayName: a.string(), preferredLanguage: a.string() })
      .returns(a.ref('GenericResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(ensureUserProfile)),

    moderateContent: a
      .mutation()
      .arguments({
        targetType: a.string().required(),
        targetId: a.id().required(),
        action: a.string().required(),
        reason: a.string(),
      })
      .returns(a.ref('ModerationResult'))
      .authorization((allow) => [allow.groups(MODERATORS)])
      .handler(a.handler.function(moderateContent)),

    /** Only an administrator can publish — enforced inside the handler too. */
    publishArticle: a
      .mutation()
      .arguments({
        articleId: a.id().required(),
        action: a.string().required(), // PUBLISH | UNPUBLISH | SCHEDULE | ARCHIVE
        scheduledFor: a.datetime(),
        changeSummary: a.string(),
      })
      .returns(a.ref('PublishResult'))
      .authorization((allow) => [allow.groups(STAFF)])
      .handler(a.handler.function(publishArticle)),

    reconcileCounters: a
      .mutation()
      .arguments({
        scope: a.string().required(), // POLLS | QUESTIONS | COMMENTS | ARTICLES
        targetId: a.id(),
        cursor: a.string(),
        maxItems: a.integer(),
      })
      .returns(a.ref('ReconcileResult'))
      .authorization((allow) => [allow.group(ADMIN)])
      .handler(a.handler.function(reconcileCounters)),

    newsletterSubscribe: a
      .mutation()
      .arguments({ email: a.string().required(), language: a.string(), source: a.string() })
      .returns(a.ref('GenericResult'))
      .authorization((allow) => [
        allow.guest(),
        allow.authenticated('identityPool'),
        allow.authenticated(),
      ])
      .handler(a.handler.function(newsletterSubscribe)),

    newsletterVerify: a
      .mutation()
      .arguments({ id: a.string().required(), token: a.string().required() })
      .returns(a.ref('GenericResult'))
      .authorization((allow) => [
        allow.guest(),
        allow.authenticated('identityPool'),
        allow.authenticated(),
      ])
      .handler(a.handler.function(newsletterVerify)),

    newsletterUnsubscribe: a
      .mutation()
      .arguments({ id: a.string().required(), signature: a.string().required() })
      .returns(a.ref('GenericResult'))
      .authorization((allow) => [
        allow.guest(),
        allow.authenticated('identityPool'),
        allow.authenticated(),
      ])
      .handler(a.handler.function(newsletterUnsubscribe)),

    searchContent: a
      .query()
      .arguments({
        query: a.string().required(),
        entityType: a.string(),
        language: a.string(),
        limit: a.integer(),
      })
      .returns(a.ref('SearchResults'))
      .authorization((allow) => [
        allow.guest(),
        allow.authenticated('identityPool'),
        allow.authenticated(),
      ])
      .handler(a.handler.function(searchContent)),
  })
  // SCHEMA-LEVEL ONLY. allow.resource() cannot be used on a model.
  // These grants are what populate AMPLIFY_DATA_* in each function's env.
  .authorization((allow) => [
    allow.resource(ensureUserProfile).to(['query', 'mutate']),
    allow.resource(publishArticle).to(['query', 'mutate']),
    allow.resource(moderateContent).to(['query', 'mutate']),
    allow.resource(reconcileCounters).to(['query', 'mutate']),
    allow.resource(submitComment).to(['query', 'mutate']),
    allow.resource(submitQuestion).to(['query', 'mutate']),
    allow.resource(submitReport).to(['query', 'mutate']),
  ])

export type Schema = ClientSchema<typeof schema>

export const data = defineData({
  name: 'rajchowk',
  schema,
  authorizationModes: {
    // Signed-in traffic and the Lambda-backed guest operations (newsletter,
    // search) use the Cognito identity pool: SigV4-signed, IAM-scopeable,
    // CloudTrail-attributable.
    defaultAuthorizationMode: 'identityPool',

    // The API key exists for ONE reason, and it is a platform constraint
    // rather than a design choice: Amplify rejects identityPool auth on
    // `a.handler.custom`, so the nine APPSYNC_JS public read queries cannot
    // use allow.guest(). It is verified, not assumed — `ampx sandbox` fails
    // with "identityPool-based auth ... is not supported with
    // a.handler.custom".
    //
    // What the key can actually reach is deliberately tiny:
    //   - the nine read-only APPSYNC_JS content queries, which return
    //     field-allowlisted custom types with the published status hard-coded
    //     server-side into a partition key the caller cannot influence; and
    //   - READ on exactly three reference models — Category, Tag and
    //     ArticleRedirect — none of which has a draft state or holds PII.
    //
    // It has no access to Article, Comment, AudienceQuestion, Vote, UserProfile
    // or anything else. So the key can read nothing an anonymous visitor could
    // not already read on the website, which is what makes shipping it in
    // amplify_outputs.json acceptable.
    //
    // 365 days is the maximum AWS permits. Rotation is a documented annual
    // task — see docs/operations-runbook.md.
    apiKeyAuthorizationMode: {
      description: 'Public read-only access to the APPSYNC_JS content queries',
      expiresInDays: 365,
    },
  },
  logging: {
    // excludeVerboseContent MUST stay true: verbose logging writes full query
    // variables to CloudWatch, which would put comment bodies and email
    // addresses in the logs.
    excludeVerboseContent: true,
    fieldLogLevel: 'error',
    retention: '2 weeks',
  },
})
