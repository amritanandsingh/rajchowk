import { defineFunction } from '@aws-amplify/backend'

export const setArticleStatus = defineFunction({
  name: 'set-article-status',
  entry: './handler.ts',
  runtime: 22,
  // A single guarded UpdateItem. Nothing here should take ten seconds, and a
  // shorter ceiling turns a wedged dependency into a fast, visible failure.
  timeoutSeconds: 10,
  memoryMB: 256,
  // Must be 'data' — see the note in ../save-article/resource.ts.
  resourceGroupName: 'data',
})
