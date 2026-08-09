import { defineFunction } from '@aws-amplify/backend'

export const saveArticle = defineFunction({
  name: 'save-article',
  entry: './handler.ts',
  // The documented default is a stale Node 18. Match .nvmrc's major so local
  // behaviour and deployed behaviour agree.
  runtime: 22,
  // Generous enough for a slug-collision retry loop plus the write, tight
  // enough that a wedged call fails while the editor is still watching.
  timeoutSeconds: 15,
  memoryMB: 512,
  /**
   * Must be 'data'. The function is referenced by amplify/data/resource.ts, so
   * it has to synthesise into the data resource group — otherwise auth, data
   * and the function land in nested stacks with a circular dependency and
   * CloudFormation refuses the whole deployment.
   */
  resourceGroupName: 'data',
})
