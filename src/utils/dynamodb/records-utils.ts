/**
 * DynamoDB utilities for record data operations
 * Handles operations on user data tables (rdb-data-{tableId})
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  QueryCommand,
  ScanCommand,
  UpdateCommand, 
  DeleteCommand,
  BatchGetCommand,
  BatchWriteCommand
} from '@aws-sdk/lib-dynamodb';

// Initialize DynamoDB clients
const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);

/**
 * Get a single record by key
 */
export async function getRecord(
  tableName: string,
  key: Record<string, any>
) {
  const result = await dynamodb.send(new GetCommand({
    TableName: tableName,
    Key: key,
  }));

  return result;
}

/**
 * Put/Create a record
 */
export async function putRecord(
  tableName: string,
  item: Record<string, any>,
  condition?: string
) {
  const params: any = {
    TableName: tableName,
    Item: item,
  };

  if (condition) {
    params.ConditionExpression = condition;
  }

  await dynamodb.send(new PutCommand(params));
}

/**
 * Update a record
 */
export async function updateRecord(
  tableName: string,
  key: Record<string, any>,
  updateExpression: string,
  expressionAttributeValues: Record<string, any>,
  expressionAttributeNames?: Record<string, string>,
  condition?: string
) {
  const params: any = {
    TableName: tableName,
    Key: key,
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW',
  };

  if (expressionAttributeNames) {
    params.ExpressionAttributeNames = expressionAttributeNames;
  }

  if (condition) {
    params.ConditionExpression = condition;
  }

  const result = await dynamodb.send(new UpdateCommand(params));
  return result;
}

/**
 * Delete a record
 */
export async function deleteRecord(
  tableName: string,
  key: Record<string, any>
) {
  const result = await dynamodb.send(new DeleteCommand({
    TableName: tableName,
    Key: key,
  }));

  return result;
}

/**
 * Query records with conditions
 */
export async function queryRecords(
  tableName: string,
  keyConditionExpression: string,
  expressionAttributeValues: Record<string, any>,
  options?: {
    indexName?: string;
    filterExpression?: string;
    projectionExpression?: string;
    expressionAttributeNames?: Record<string, string>;
    limit?: number;
    exclusiveStartKey?: Record<string, any>;
    scanIndexForward?: boolean;
  }
) {
  const params: any = {
    TableName: tableName,
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: expressionAttributeValues,
  };

  if (options?.indexName) params.IndexName = options.indexName;
  if (options?.filterExpression) params.FilterExpression = options.filterExpression;
  if (options?.projectionExpression) params.ProjectionExpression = options.projectionExpression;
  if (options?.expressionAttributeNames) params.ExpressionAttributeNames = options.expressionAttributeNames;
  if (options?.limit) params.Limit = options.limit;
  if (options?.exclusiveStartKey) params.ExclusiveStartKey = options.exclusiveStartKey;
  if (options?.scanIndexForward !== undefined) params.ScanIndexForward = options.scanIndexForward;

  const result = await dynamodb.send(new QueryCommand(params));
  return result;
}

/**
 * Scan records (use sparingly, prefer Query when possible)
 */
export async function scanRecords(
  tableName: string,
  options?: {
    filterExpression?: string;
    expressionAttributeValues?: Record<string, any>;
    expressionAttributeNames?: Record<string, string>;
    projectionExpression?: string;
    limit?: number;
    exclusiveStartKey?: Record<string, any>;
  }
) {
  const params: any = {
    TableName: tableName,
  };

  if (options?.filterExpression) {
    params.FilterExpression = options.filterExpression;
    if (options.expressionAttributeValues) {
      params.ExpressionAttributeValues = options.expressionAttributeValues;
    }
  }
  if (options?.expressionAttributeNames) params.ExpressionAttributeNames = options.expressionAttributeNames;
  if (options?.projectionExpression) params.ProjectionExpression = options.projectionExpression;
  if (options?.limit) params.Limit = options.limit;
  if (options?.exclusiveStartKey) params.ExclusiveStartKey = options.exclusiveStartKey;

  const result = await dynamodb.send(new ScanCommand(params));
  return result;
}

/**
 * Batch get multiple records
 */
export async function batchGetRecords(
  tableName: string,
  keys: Record<string, any>[]
) {
  const result = await dynamodb.send(new BatchGetCommand({
    RequestItems: {
      [tableName]: {
        Keys: keys,
      },
    },
  }));

  return result;
}

/**
 * Batch write (put/delete) multiple records
 */
export async function batchWriteRecords(
  tableName: string,
  putRequests?: Record<string, any>[],
  deleteRequests?: Record<string, any>[]
) {
  const writeRequests: any[] = [];

  if (putRequests && putRequests.length > 0) {
    putRequests.forEach(item => {
      writeRequests.push({
        PutRequest: {
          Item: item,
        },
      });
    });
  }

  if (deleteRequests && deleteRequests.length > 0) {
    deleteRequests.forEach(key => {
      writeRequests.push({
        DeleteRequest: {
          Key: key,
        },
      });
    });
  }

  const result = await dynamodb.send(new BatchWriteCommand({
    RequestItems: {
      [tableName]: writeRequests,
    },
  }));

  return result;
}

/**
 * Export the DynamoDB client for advanced usage
 */
export { dynamodb };
