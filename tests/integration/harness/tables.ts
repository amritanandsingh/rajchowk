import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
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

/** The physical table backing a model, e.g. `Article` -> `Article-abc123-NONE`. */
export async function tableFor(model: string): Promise<string> {
  const hit = resolved.get(model)
  if (hit) return hit

  const names = await allTableNames()
  // Anchor on the trailing hyphen so `Article` cannot match `ArticleTag`.
  const match = names.find((name) => name.startsWith(`${model}-`))
  if (!match) {
    throw new Error(
      `No DynamoDB table found for model "${model}". Is the sandbox deployed and current?`,
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
