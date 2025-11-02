/**
 * DynamoDB utilities for table metadata operations
 * Handles operations on the rdb-tables table
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  QueryCommand, 
  UpdateCommand, 
  DeleteCommand 
} from '@aws-sdk/lib-dynamodb';
import { 
  DynamoDBClient as DynamoDBServiceClient, 
  CreateTableCommand, 
  DeleteTableCommand,
  CreateTableCommandInput,
  AttributeDefinition,
  KeySchemaElement
} from '@aws-sdk/client-dynamodb';

// Initialize DynamoDB clients
const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const dynamodbService = new DynamoDBServiceClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Environment variables
const TABLES_TABLE_NAME = process.env.TABLES_TABLE_NAME!;

/**
 * Get all tables for an API key
 */
export async function queryTablesByApiKey(apiKey: string) {
  const result = await dynamodb.send(new QueryCommand({
    TableName: TABLES_TABLE_NAME,
    KeyConditionExpression: 'apiKey = :apiKey',
    ExpressionAttributeValues: {
      ':apiKey': apiKey,
    },
  }));

  return result;
}

/**
 * Get a specific table by API key and table name
 */
export async function getTable(apiKey: string, tableName: string) {
  const result = await dynamodb.send(new GetCommand({
    TableName: TABLES_TABLE_NAME,
    Key: { apiKey, tableName },
  }));

  return result;
}

/**
 * Create/Put a table metadata record
 */
export async function putTable(tableItem: any, condition?: string) {
  const params: any = {
    TableName: TABLES_TABLE_NAME,
    Item: tableItem,
  };

  if (condition) {
    params.ConditionExpression = condition;
  }

  await dynamodb.send(new PutCommand(params));
}

/**
 * Update a table metadata record
 */
export async function updateTable(
  apiKey: string,
  tableName: string,
  updateExpression: string,
  expressionAttributeValues: Record<string, any>,
  expressionAttributeNames?: Record<string, string>
) {
  const params: any = {
    TableName: TABLES_TABLE_NAME,
    Key: { apiKey, tableName },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW',
  };

  if (expressionAttributeNames) {
    params.ExpressionAttributeNames = expressionAttributeNames;
  }

  const result = await dynamodb.send(new UpdateCommand(params));
  return result;
}

/**
 * Delete a table metadata record
 */
export async function deleteTableMetadata(apiKey: string, tableName: string) {
  await dynamodb.send(new DeleteCommand({
    TableName: TABLES_TABLE_NAME,
    Key: { apiKey, tableName },
  }));
}

/**
 * Create a DynamoDB table for user data
 */
export async function createUserDataTable(
  tableId: string,
  keySchema: KeySchemaElement[],
  attributeDefinitions: AttributeDefinition[],
  globalSecondaryIndexes?: Array<{
    IndexName: string;
    KeySchema: KeySchemaElement[];
    Projection: { ProjectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE'; NonKeyAttributes?: string[] };
  }>
): Promise<void> {
  const params: CreateTableCommandInput = {
    TableName: `rdb-data-${tableId}`,
    KeySchema: keySchema,
    AttributeDefinitions: attributeDefinitions,
    BillingMode: 'PAY_PER_REQUEST',
    StreamSpecification: {
      StreamEnabled: true,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  };

  // Add Global Secondary Indexes for indexed fields (enables efficient Query operations)
  if (globalSecondaryIndexes && globalSecondaryIndexes.length > 0) {
    params.GlobalSecondaryIndexes = globalSecondaryIndexes;
  }

  await dynamodbService.send(new CreateTableCommand(params));
}

/**
 * Delete a user data table
 */
export async function deleteUserDataTable(tableId: string): Promise<void> {
  try {
    await dynamodbService.send(new DeleteTableCommand({
      TableName: `rdb-data-${tableId}`,
    }));
  } catch (error: any) {
    if (error.name !== 'ResourceNotFoundException') {
      throw error;
    }
    // Silently ignore if table doesn't exist
  }
}

/**
 * Export the DynamoDB clients for advanced usage
 */
export { dynamodb, dynamodbService };
