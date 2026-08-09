import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Deployed-backend configuration.
 *
 * `amplify_outputs.json` is gitignored and produced by `ampx sandbox`, so the
 * integration suite cannot run on a fresh clone until someone has deployed.
 * Failing here with a readable message beats a confusing auth error twenty
 * lines later.
 */

type AmplifyOutputs = {
  auth: {
    aws_region: string
    user_pool_id: string
    user_pool_client_id: string
    identity_pool_id?: string
  }
  data: { url: string; aws_region: string; api_key?: string; default_authorization_type: string }
  storage?: { bucket_name: string }
  custom?: Record<string, unknown>
}

let cached: AmplifyOutputs | undefined

export function amplifyOutputs(): AmplifyOutputs {
  if (cached) return cached

  const path = resolve(process.cwd(), 'amplify_outputs.json')
  try {
    cached = JSON.parse(readFileSync(path, 'utf8')) as AmplifyOutputs
  } catch {
    throw new Error(
      'amplify_outputs.json is missing or unreadable.\n' +
        'The integration suite runs against a REAL deployed backend.\n' +
        'Deploy one first:  npx ampx sandbox --once',
    )
  }

  if (!cached.auth?.user_pool_id || !cached.data?.url) {
    throw new Error('amplify_outputs.json is present but incomplete — redeploy the sandbox.')
  }

  return cached
}

export const region = (): string => amplifyOutputs().auth.aws_region
export const userPoolId = (): string => amplifyOutputs().auth.user_pool_id
export const userPoolClientId = (): string => amplifyOutputs().auth.user_pool_client_id

/**
 * Guard against ever pointing this suite at production.
 *
 * The tests create users and rows and then delete them. Running that against a
 * real audience would be unrecoverable, so the check is cheap insurance.
 */
export function assertNotProduction(): void {
  const environment = String(amplifyOutputs().custom?.environment ?? 'unknown')
  if (environment === 'production') {
    throw new Error(
      `Refusing to run integration tests against environment "${environment}". ` +
        'These tests create and delete real data.',
    )
  }
}
