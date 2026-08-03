import { defineStorage } from '@aws-amplify/backend'
import { publishArticle } from '../functions/publish-article/resource'

/**
 * Media storage.
 *
 * Path rules that the type system does not enforce but the deployment does:
 *  - every path must end in `/*` and must not start with `/`
 *  - at most one level of nesting below the prefix root
 *  - `{entity_id}` resolves to the caller's Cognito IdentityId, and only
 *    means anything for `allow.entity('identity')`; for every other principal
 *    it is substituted with `*`
 *  - `read` is mutually exclusive with `get`/`list` in `.to()`
 *
 * The important line here is `internal/editorial/drafts/*`, which has NO guest
 * rule at all. That is the prefix that would otherwise leak an embargoed
 * story's imagery before publication. Publishing COPIES the approved asset
 * into the public prefix rather than flipping an ACL: a copy is auditable, and
 * it means the draft prefix never needs a public grant that could be got wrong.
 */
export const storage = defineStorage({
  name: 'rajchowkMedia',
  isDefault: true,
  access: (allow) => ({
    'media/articles/hero/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read']),
      allow.groups(['ADMIN', 'EDITOR']).to(['read', 'write', 'delete']),
      allow.resource(publishArticle).to(['read', 'write']),
    ],
    'media/articles/social/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read']),
      allow.groups(['ADMIN', 'EDITOR']).to(['read', 'write', 'delete']),
      allow.resource(publishArticle).to(['read', 'write']),
    ],
    'media/events/covers/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read']),
      allow.groups(['ADMIN', 'EDITOR']).to(['read', 'write', 'delete']),
    ],
    // Promise evidence is public by design: the whole value of a promise
    // tracker is that the receipts are checkable by the reader.
    'media/promises/evidence/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read']),
      allow.groups(['ADMIN', 'EDITOR']).to(['read', 'write', 'delete']),
    ],
    // Avatars appear next to comments, so reads are public; writes are scoped
    // to the caller's own identity prefix. Moderators can delete an abusive
    // avatar without being able to overwrite one.
    'media/profiles/{entity_id}/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read']),
      allow.entity('identity').to(['read', 'write', 'delete']),
      allow.groups(['ADMIN', 'MODERATOR']).to(['read', 'delete']),
    ],
    'internal/editorial/drafts/*': [
      allow.groups(['ADMIN', 'EDITOR']).to(['read', 'write', 'delete']),
      allow.resource(publishArticle).to(['read', 'write', 'delete']),
    ],
    'internal/moderation/evidence/*': [
      allow.groups(['ADMIN', 'MODERATOR']).to(['read', 'write', 'delete']),
    ],
  }),
})
