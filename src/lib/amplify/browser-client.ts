'use client'

import { Amplify } from 'aws-amplify'
import { generateClient } from 'aws-amplify/data'
import type { Schema } from '@/../amplify/data/resource'
import outputs from '@/../amplify_outputs.json'

let configured = false

export function configureBrowserAmplify(): void {
  if (configured) return
  Amplify.configure(outputs, { ssr: true })
  configured = true
}

configureBrowserAmplify()

export const browserDataClient = generateClient<Schema>()

export function readableAmplifyError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'कुछ गलत हो गया। कृपया फिर से कोशिश करें।'
}
