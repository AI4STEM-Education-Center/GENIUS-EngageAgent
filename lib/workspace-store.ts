import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import fs from "node:fs/promises";
import path from "node:path";

type RecordValue = Record<string, unknown>;
type Stored = { class_id: string; record_id: string; value: RecordValue };
const file = () => path.join(process.env.ENGAGE_LOCAL_DATA_DIR || path.join(process.cwd(), "data"), "workspace.json");
let writes = Promise.resolve();
let client: DynamoDBDocumentClient | undefined;

function database() {
  if (!process.env.DYNAMODB_TABLE) {
    if (process.env.NODE_ENV === "production") throw new Error("DYNAMODB_TABLE is required for the EngageAgent workspace.");
    return null;
  }
  if (!client) client = DynamoDBDocumentClient.from(new DynamoDBClient({
    region: process.env.ENGAGE_AWS_REGION || "us-east-2",
    ...(process.env.ENGAGE_AWS_ACCESS_KEY_ID && process.env.ENGAGE_AWS_SECRET_ACCESS_KEY ? {
      credentials: { accessKeyId: process.env.ENGAGE_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.ENGAGE_AWS_SECRET_ACCESS_KEY },
    } : {}),
  }));
  return client;
}

async function localRecords(): Promise<Stored[]> {
  try { return JSON.parse(await fs.readFile(file(), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export async function workspaceGet<T>(partition: string, key: string): Promise<T | null> {
  const db = database();
  if (db) {
    const result = await db.send(new GetCommand({ TableName: process.env.DYNAMODB_TABLE,
      Key: { class_id: partition, record_id: key }, ConsistentRead: true }));
    return (result.Item?.value as T) || null;
  }
  await writes;
  return (await localRecords()).find(row => row.class_id === partition && row.record_id === key)?.value as T || null;
}

export async function workspaceQuery<T>(partition: string, prefix: string): Promise<T[]> {
  const db = database();
  if (!db) {
    await writes;
    return (await localRecords()).filter(row => row.class_id === partition && row.record_id.startsWith(prefix)).map(row => row.value as T);
  }
  const values: T[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const result = await db.send(new QueryCommand({ TableName: process.env.DYNAMODB_TABLE,
      KeyConditionExpression: "class_id = :pk AND begins_with(record_id, :prefix)",
      ExpressionAttributeValues: { ":pk": partition, ":prefix": prefix }, ConsistentRead: true, ExclusiveStartKey: cursor }));
    values.push(...(result.Items || []).map(row => row.value as T));
    cursor = result.LastEvaluatedKey;
  } while (cursor);
  return values;
}

export async function workspacePut(records: { partition: string; key: string; value: RecordValue; createOnly?: boolean }[]) {
  const db = database();
  if (db) {
    await db.send(new TransactWriteCommand({ TransactItems: records.map(row => ({ Put: {
      TableName: process.env.DYNAMODB_TABLE,
      Item: { class_id: row.partition, record_id: row.key, value: row.value },
      ...(row.createOnly ? { ConditionExpression: "attribute_not_exists(record_id)" } : {}),
    } })) }));
    return;
  }
  const operation = writes.then(async () => {
    let stored = await localRecords();
    for (const row of records) {
      const matches = (item: Stored) => item.class_id === row.partition && item.record_id === row.key;
      if (row.createOnly && stored.some(matches)) throw new Error("Workspace record already exists.");
      stored = stored.filter(item => !matches(item));
      stored.push({ class_id: row.partition, record_id: row.key, value: row.value });
    }
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(`${file()}.tmp`, JSON.stringify(stored), { mode: 0o600 });
    await fs.rename(`${file()}.tmp`, file());
  });
  writes = operation.catch(() => {});
  return operation;
}
