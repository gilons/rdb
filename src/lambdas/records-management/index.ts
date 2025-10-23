import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  GetCommand, 
  ScanCommand, 
  PutCommand, 
  DeleteCommand 
} from '@aws-sdk/lib-dynamodb';
import { AppSyncClient } from '@aws-sdk/client-appsync';
import * as crypto from 'crypto';

const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const appSync = new AppSyncClient({ region: process.env.AWS_REGION || 'us-east-1' });

const TABLES_TABLE_NAME = process.env.TABLES_TABLE_NAME!;
const APPSYNC_API_ID = process.env.APPSYNC_API_ID!;

interface TableRecord {
  [key: string]: any;
  createdAt?: string;
  updatedAt?: string;
}

interface TableField {
  name: string;
  type: string;
  required?: boolean;
  primary?: boolean;
  indexed?: boolean;
}

interface TableInfo {
  tableId: string;
  tableName: string;
  fields: TableField[];
  apiKey: string;
  subscriptions?: any[];
}

/**
 * Lambda handler for records management operations
 * Supports: CREATE, LIST, DELETE records in user tables
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('Event received for records management operation');

  const { httpMethod, headers, pathParameters, body, requestContext, queryStringParameters } = event;
  const apiKey = headers['X-Api-Key'] || (requestContext as any)?.authorizer?.apiKey;
  const tableName = pathParameters?.tableName;

  if (!apiKey) {
    return {
      statusCode: 401,
      headers: getCorsHeaders(),
      body: JSON.stringify({ 
        success: false,
        error: 'Missing API key' 
      }),
    };
  }

  const apiKeyHash = getApiKeyHash(apiKey);
  console.log('Processing request for API key hash:', apiKeyHash, 'table:', tableName);

  if (!tableName) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(),
      body: JSON.stringify({ 
        success: false,
        error: 'Table name is required' 
      }),
    };
  }

  try {
    // Verify table exists and get table info
    const tableInfo = await getTableInfo(apiKeyHash, tableName);
    if (!tableInfo) {
      return {
        statusCode: 404,
        headers: getCorsHeaders(),
        body: JSON.stringify({ 
          success: false,
          error: 'Table not found' 
        }),
      };
    }

    switch (httpMethod) {
      case 'GET':
        return await listRecords(tableInfo, queryStringParameters);
      case 'POST':
        let recordData: TableRecord;
        try {
          recordData = JSON.parse(body || '{}');
        } catch (parseError) {
          return {
            statusCode: 400,
            headers: getCorsHeaders(),
            body: JSON.stringify({ error: 'Invalid JSON in request body' }),
          };
        }
        return await createRecord(tableInfo, recordData);
      case 'DELETE':
        return await deleteRecord(tableInfo, pathParameters?.recordId);
      default:
        return {
          statusCode: 405,
          headers: getCorsHeaders(),
          body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(),
      body: JSON.stringify({ 
        error: 'Internal server error', 
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};

/**
 * Get table information
 */
async function getTableInfo(apiKey: string, tableName: string): Promise<TableInfo | null> {
  const result = await dynamodb.send(new GetCommand({
    TableName: TABLES_TABLE_NAME,
    Key: { apiKey, tableName },
  }));

  return result.Item as TableInfo || null;
}

/**
 * List records in a table
 */
async function listRecords(
  tableInfo: TableInfo,
  queryParams: { [key: string]: string | undefined } | null
): Promise<APIGatewayProxyResult> {
  const dataTableName = `rdb-data-${tableInfo.tableId}`;
  const limitParam = queryParams?.limit;
  const limit = limitParam && !isNaN(parseInt(limitParam)) ? parseInt(limitParam) : 50;
  const nextToken = queryParams?.nextToken;

  const params = {
    TableName: dataTableName,
    Limit: Math.min(limit, 100), // Cap at 100
  } as any;

  if (nextToken) {
    try {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
    } catch (error) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(),
        body: JSON.stringify({ error: 'Invalid nextToken parameter' }),
      };
    }
  }

  const result = await dynamodb.send(new ScanCommand(params));

  return {
    statusCode: 200,
    headers: getCorsHeaders(),
    body: JSON.stringify({
      success: true,
      data: {
        items: result.Items || [],
        count: result.Count || 0,
        nextToken: result.LastEvaluatedKey 
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : null,
      }
    }),
  };
}

/**
 * Create a record in a table
 */
async function createRecord(tableInfo: TableInfo, recordData: TableRecord): Promise<APIGatewayProxyResult> {
  const dataTableName = `rdb-data-${tableInfo.tableId}`;
  const { fields } = tableInfo;

  // Validate required fields
  const requiredFields = fields.filter(field => field.required);
  for (const field of requiredFields) {
    if (recordData[field.name] === undefined || recordData[field.name] === null || recordData[field.name] === '') {
      return {
        statusCode: 400,
        headers: getCorsHeaders(),
        body: JSON.stringify({ error: `Required field '${field.name}' is missing` }),
      };
    }
  }

  // Validate field types
  for (const field of fields) {
    const value = recordData[field.name];
    if (value !== undefined && !validateFieldType(value, field.type)) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(),
        body: JSON.stringify({ 
          error: `Invalid type for field '${field.name}'. Expected ${field.type}` 
        }),
      };
    }
  }

  // Add timestamps
  const timestamp = new Date().toISOString();
  const record = {
    ...recordData,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  // Save to DynamoDB
  await dynamodb.send(new PutCommand({
    TableName: dataTableName,
    Item: record,
  }));

  // Trigger AppSync mutation for real-time updates
  await triggerAppSyncMutation(tableInfo, 'create', record);

  return {
    statusCode: 201,
    headers: getCorsHeaders(),
    body: JSON.stringify({
      success: true,
      message: 'Record created successfully',
      data: record,
    }),
  };
}

/**
 * Delete a record from a table
 */
async function deleteRecord(tableInfo: TableInfo, recordId: string | undefined): Promise<APIGatewayProxyResult> {
  if (!recordId) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(),
      body: JSON.stringify({ error: 'Record ID is required' }),
    };
  }

  const dataTableName = `rdb-data-${tableInfo.tableId}`;
  const { fields } = tableInfo;
  const primaryKey = fields.find(f => f.primary) || fields[0];

  if (!primaryKey) {
    return {
      statusCode: 500,
      headers: getCorsHeaders(),
      body: JSON.stringify({ error: 'No primary key found in table definition' }),
    };
  }

  // Get the record first for real-time notifications
  const getResult = await dynamodb.send(new GetCommand({
    TableName: dataTableName,
    Key: { [primaryKey.name]: recordId },
  }));

  if (!getResult.Item) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(),
      body: JSON.stringify({ error: 'Record not found' }),
    };
  }

  // Delete from DynamoDB
  await dynamodb.send(new DeleteCommand({
    TableName: dataTableName,
    Key: { [primaryKey.name]: recordId },
  }));

  // Trigger AppSync mutation for real-time updates
  await triggerAppSyncMutation(tableInfo, 'delete', getResult.Item);

  return {
    statusCode: 200,
    headers: getCorsHeaders(),
    body: JSON.stringify({ 
      success: true,
      message: 'Record deleted successfully' 
    }),
  };
}

/**
 * Validate field type against expected type
 */
function validateFieldType(value: any, expectedType: string): boolean {
  switch (expectedType.toLowerCase()) {
    case 'string':
      return typeof value === 'string';
    case 'int':
    case 'integer':
      return Number.isInteger(value);
    case 'float':
    case 'double':
      return typeof value === 'number' && !isNaN(value);
    case 'boolean':
    case 'bool':
      return typeof value === 'boolean';
    case 'array':
    case 'list':
      return Array.isArray(value);
    default:
      // For unknown types, allow any value
      return true;
  }
}

/**
 * Trigger AppSync mutation for real-time updates
 */
async function triggerAppSyncMutation(tableInfo: TableInfo, operation: string, record: TableRecord): Promise<void> {
  // This would integrate with AppSync to send real-time updates
  // For now, we'll log the event that would be sent (without exposing sensitive data)
  console.log('AppSync mutation trigger:', {
    tableName: tableInfo.tableName,
    operation,
    recordId: record.id || '[no-id]',
    timestamp: new Date().toISOString(),
  });

  // In a real implementation, this would:
  // 1. Format the mutation based on the operation
  // 2. Send the mutation to AppSync
  // 3. AppSync would then notify all subscribers
}

/**
 * Generate a consistent hash for API key (for logging and identification)
 * This ensures API keys are never exposed in logs
 */
function getApiKeyHash(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 8);
}

/**
 * Sanitize API key for secure logging - only show first 4 chars and hash
 */
function sanitizeApiKeyForLogging(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) return '[INVALID_KEY]';
  const prefix = apiKey.substring(0, 4);
  const hash = getApiKeyHash(apiKey);
  return `${prefix}***[${hash}]`;
}

function getCorsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Amz-Date, Authorization, X-Api-Key',
  };
}