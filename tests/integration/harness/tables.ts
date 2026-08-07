import {
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  ListTagsOfResourceCommand,
} from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import { region } from './outputs'

/**
 * Physical DynamoDB table access.
 *
 * Two things this module exists for:
 *
 * 1. Table names cannot be derived from the AppSync endpoint. Amplify names
 *    tables `<Model>-<apiId>-<envName>`, and the apiId is NOT the endpoint
 *    subdomain — they are different identifiers. So names are resolved once by
 *    listing tables and matching the model prefix.
 *
 * 2. State assertions use a CONSISTENT read here rather than GraphQL. GSI reads
 *    are eventually consistent, so asserting a counter through an index right
 *    after a write is inherently flaky. The rule across this suite:
 *    GraphQL for what a PRINCIPAL CAN SEE, raw DynamoDB for what the STATE IS.
 */

const raw = new DynamoDBClient({ region: region() })
export const ddb = DynamoDBDocumentClient.from(raw)

let tableNames: string[] | undefined
const resolved = new Map<string, string>()

async function allTableNames(): Promise<string[]> {
  if (tableNames) return tableNames

  const names: string[] = []
  let start: string | undefined
  do {
    const page = await raw.send(
      new ListTablesCommand(start ? { ExclusiveStartTableName: start } : {}),
    )
    names.push(...(page.TableNames ?? []))
    start = page.LastEvaluatedTableName
  } while (start)

  tableNames = names
  return names
}

let sandboxApiId: string | undefined

/**
 * The API id of the SANDBOX deployment, proven by resource tags.
 *
 * This is a safety guard, not a convenience. One AWS account routinely holds
 * both the sandbox and a deployed branch, and every model then has two tables —
 * `Article-<sandboxApiId>-NONE` and `Article-<branchApiId>-NONE`. Matching on
 * the model prefix alone returns whichever `ListTables` happens to sort first,
 * so a suite that creates, publishes and DELETES rows would silently operate on
 * the production table the moment a redeployed sandbox drew an api id sorting
 * after the branch's. `assertNotProduction()` does not cover this path: it reads
 * amplify_outputs.json, which describes the GraphQL endpoint, while this module
 * enumerates the account.
 *
 * Amplify tags every table it creates with `amplify:deployment-type` —
 * `sandbox` for `ampx sandbox`, `branch` (plus `amplify:branch-name`) for a
 * Hosting deployment. That tag is the only unambiguous discriminator, and
 * reading it needs nothing beyond the DynamoDB client already used here.
 */
async function sandboxApiIdFrom(names: string[]): Promise<string> {
  if (sandboxApiId) return sandboxApiId

  // Category exists in every deployment of this schema and has no hyphen in its
  // model name, so `<model>-<apiId>-<envName>` splits cleanly.
  const candidates = names.filter((name) => /^Category-[^-]+-[^-]+$/.test(name))
  const seen: string[] = []

  for (const name of candidates) {
    const described = await raw.send(new DescribeTableCommand({ TableName: name }))
    const arn = described.Table?.TableArn
    if (!arn) continue
    const tags = await raw.send(new ListTagsOfResourceCommand({ ResourceArn: arn }))
    const deploymentType = tags.Tags?.find((tag) => tag.Key === 'amplify:deployment-type')?.Value
    const branch = tags.Tags?.find((tag) => tag.Key === 'amplify:branch-name')?.Value
    seen.push(`${name} (${deploymentType ?? 'untagged'}${branch ? `:${branch}` : ''})`)
    if (deploymentType === 'sandbox') {
      sandboxApiId = name.split('-').at(-2)
      if (sandboxApiId) return sandboxApiId
    }
  }

  throw new Error(
    'Could not identify a SANDBOX DynamoDB deployment in this account.\n' +
      `Tables considered: ${seen.length ? seen.join(', ') : '(none)'}\n` +
      'Refusing to fall back to a branch deployment — these tests delete rows.\n' +
      'Deploy a sandbox first:  npx ampx sandbox --once',
  )
}

/** The physical table backing a model, e.g. `Article` -> `Article-abc123-NONE`. */
export async function tableFor(model: string): Promise<string> {
  const hit = resolved.get(model)
  if (hit) return hit

  const names = await allTableNames()
  const apiId = await sandboxApiIdFrom(names)
  // Pinned to the sandbox api id, and anchored on the trailing hyphen so
  // `Article` cannot match `ArticleTag`.
  const match = names.find((name) => name.startsWith(`${model}-${apiId}-`))
  if (!match) {
    throw new Error(
      `No DynamoDB table found for model "${model}" in sandbox ${apiId}. ` +
        'Is the sandbox deployed and current?',
    )
  }

  resolved.set(model, match)
  return match
}

/** Strongly-consistent read of one row. Use for state assertions. */
export async function getRow<T = Record<string, unknown>>(
  model: string,
  key: Record<string, unknown>,
): Promise<T | undefined> {
  const result = await ddb.send(
    new GetCommand({ TableName: await tableFor(model), Key: key, ConsistentRead: true }),
  )
  return result.Item as T | undefined
}

export async function deleteRow(model: string, key: Record<string, unknown>): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: await tableFor(model), Key: key }))
}

/** Count rows on an index. Used to assert counters against their source rows. */
export async function countByIndex(
  model: string,
  indexName: string,
  keyExpression: string,
  values: Record<string, unknown>,
): Promise<number> {
  let total = 0
  let start: Record<string, unknown> | undefined

  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: await tableFor(model),
        IndexName: indexName,
        KeyConditionExpression: keyExpression,
        ExpressionAttributeValues: values,
        Select: 'COUNT',
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    )
    total += page.Count ?? 0
    start = page.LastEvaluatedKey
  } while (start)

  return total
}
