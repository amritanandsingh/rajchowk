import { defineFunction } from '@aws-amplify/backend'

export const createMediaUploadUrl = defineFunction({
  name: 'create-media-upload-url',
  entry: './handler.ts',
  // Match .nvmrc's major so local behaviour and deployed behaviour agree; the
  // documented default is a stale Node 18.
  runtime: 22,
  // Signing is arithmetic — no network call leaves this function. The timeout
  // is short on purpose: if this is slow, something is wrong, and the editor
  // should find out while they are still looking at the form.
  timeoutSeconds: 10,
  memoryMB: 512,
  /**
   * Must be 'data', for the same reason as save-article: the function is
   * referenced from amplify/data/resource.ts, so it has to synthesise into the
   * data resource group or auth, data and the function land in nested stacks
   * with a circular dependency and CloudFormation refuses the deployment.
   */
  resourceGroupName: 'data',
})
