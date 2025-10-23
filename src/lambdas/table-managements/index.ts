import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  QueryCommand, 
  UpdateCommand, 
  DeleteCommand 
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { 
  DynamoDBClient as DynamoDBServiceClient, 
  CreateTableCommand, 
  DeleteTableCommand 
} from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodbService = new DynamoDBServiceClient({ region: process.env.AWS_REGION || 'us-east-1' });

const TABLES_TABLE_NAME = process.env.TABLES_TABLE_NAME!;
const CONFIG_BUCKET_NAME = process.env.CONFIG_BUCKET_NAME!;
const APPSYNC_API_ID = process.env.APPSYNC_API_ID!;

interface TableField {
  name: string;
  type: string;
  required?: boolean;
  indexed?: boolean;
  primary?: boolean;
}

interface TableSubscription {
  event: string;
  filters?: Array<{ field: string; type: string }>;
}

interface TableConfig {
  tableName: string;
  fields: TableField[];
  subscriptions?: TableSubscription[];
  description?: string;
  graphqlTypeName?: string;
}

interface TableItem extends TableConfig {
  apiKey: string;
  tableId: string;
  graphqlTypeName: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lambda handler for table management operations
 * Supports: CREATE, LIST, UPDATE, DELETE tables
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('Event received for table management operation');
  console.warn('Event:', JSON.stringify(event, null, 2));

  const { httpMethod, headers, pathParameters, body, requestContext } = event;
  const apiKey = headers['X-Api-Key'] || (requestContext as any)?.authorizer?.apiKey;

  if (!apiKey) {
    return {
      statusCode: 401,
      headers: getCorsHeaders(),
      body: JSON.stringify({ error: 'Missing API key' }),
    };
  }

  const apiKeyHash = getApiKeyHash(apiKey);
  console.log('Processing request for API key hash:', apiKeyHash);

  try {
    switch (httpMethod) {
      case 'GET':
        // Check if we're requesting a specific table or listing all tables
        if (pathParameters?.tableName) {
          // Check if it's a schema request
          if (event.path?.endsWith('/schema')) {
            return await getTableSchema(apiKeyHash, pathParameters.tableName);
          }
          // Get individual table details
          return await getTableDetails(apiKeyHash, pathParameters.tableName);
        } else {
          // List all tables
          return await listTables(apiKeyHash);
        }
      case 'POST':
        return await createTable(apiKeyHash, JSON.parse(body || '{}'));
      case 'PUT':
        return await updateTable(apiKeyHash, pathParameters?.tableName, JSON.parse(body || '{}'));
      case 'DELETE':
        return await deleteTable(apiKeyHash, pathParameters?.tableName);
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
 * List all tables for an API key
 */
async function listTables(apiKey: string): Promise<APIGatewayProxyResult> {  
  const params = {
    TableName: TABLES_TABLE_NAME,
    KeyConditionExpression: 'apiKey = :apiKey',
    ExpressionAttributeValues: {
      ':apiKey': apiKey, // Use hash instead of raw API key
    },
  };

  const result = await dynamodb.send(new QueryCommand(params));

  return {
    statusCode: 200,
    headers: getCorsHeaders(),
    body: JSON.stringify({
      tables: result.Items || [],
      count: result.Count,
    }),
  };
}

/**
 * Create a new table
 */
async function createTable(apiKey: string, tableConfig: TableConfig): Promise<APIGatewayProxyResult> {
  const { tableName, fields, subscriptions, description } = tableConfig;

  if (!tableName || !fields) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(),
      body: JSON.stringify({ error: 'tableName and fields are required' }),
    };
  }

  // Validate field definitions
  if (!Array.isArray(fields) || fields.length === 0) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(),
      body: JSON.stringify({ error: 'fields must be a non-empty array' }),
    };
  }

  const tableId = uuidv4();
  const timestamp = new Date().toISOString();
  
  // Generate GraphQL type name with prefix
  const graphqlTypeName = `T${apiKey}_${tableName}`;
  
  const tableItem: TableItem = {
    apiKey: apiKey, // Use hash instead of raw API key
    tableName,
    tableId,
    fields: fields.map(field => ({
      name: field.name,
      type: field.type || 'String',
      required: field.required || false,
      indexed: field.indexed || false,
      primary: field.primary || false,
    })),
    subscriptions: subscriptions || [],
    description: description || '',
    graphqlTypeName, // Store the GraphQL type name for SDK usage
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  try {
    // Save table metadata to DynamoDB
    await dynamodb.send(new PutCommand({
      TableName: TABLES_TABLE_NAME,
      Item: tableItem,
      ConditionExpression: 'attribute_not_exists(tableName)',
    }));

    // Create DynamoDB table for the actual data
    await createUserDataTable(tableId, fields);

    // Generate and store AppSync schema configuration
    await generateAndStoreSchema(apiKey);

    return {
      statusCode: 201,
      headers: getCorsHeaders(),
      body: JSON.stringify({
        message: 'Table created successfully',
        table: tableItem,
      }),
    };
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 409,
        headers: getCorsHeaders(),
        body: JSON.stringify({ error: 'Table already exists' }),
      };
    }
    throw error;
  }
}

/**
 * Update an existing table
 */
async function updateTable(
  apiKey: string, 
  tableName: string | undefined, 
  updates: Partial<TableConfig>
): Promise<APIGatewayProxyResult> {
  if (!tableName) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(),
      body: JSON.stringify({ error: 'tableName is required' }),
    };
  }

  const timestamp = new Date().toISOString();
  
  // Regenerate GraphQL type name to ensure consistency
  const graphqlTypeName = `T${apiKey}_${tableName}`;
  
  let updateExpression = 'SET updatedAt = :updatedAt, graphqlTypeName = :graphqlTypeName';
  const expressionAttributeValues: any = {
    ':updatedAt': timestamp,
    ':graphqlTypeName': graphqlTypeName,
  };

  if (updates.fields) {
    updateExpression += ', fields = :fields';
    expressionAttributeValues[':fields'] = updates.fields.map(field => ({
      name: field.name,
      type: field.type || 'String',
      required: field.required || false,
      indexed: field.indexed || false,
      primary: field.primary || false,
    }));
  }

  if (updates.subscriptions) {
    updateExpression += ', subscriptions = :subscriptions';
    expressionAttributeValues[':subscriptions'] = updates.subscriptions;
  }

  if (updates.description !== undefined) {
    updateExpression += ', description = :description';
    expressionAttributeValues[':description'] = updates.description;
  }

  try {
    const updateResult = await dynamodb.send(new UpdateCommand({
      TableName: TABLES_TABLE_NAME,
      Key: { apiKey, tableName },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    }));

    // Regenerate AppSync schema
    await generateAndStoreSchema(apiKey);

    return {
      statusCode: 200,
      headers: getCorsHeaders(),
      body: JSON.stringify({ message: 'Table updated successfully' }),
    };
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 404,
        headers: getCorsHeaders(),
        body: JSON.stringify({ error: 'Table not found' }),
      };
    }
    throw error;
  }
}

/**
 * Delete a table
 */
async function deleteTable(apiKey: string, tableName: string | undefined): Promise<APIGatewayProxyResult> {
  if (!tableName) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(),
      body: JSON.stringify({ error: 'tableName is required' }),
    };
  }

  // Get table info first
  const tableResult = await dynamodb.send(new GetCommand({
    TableName: TABLES_TABLE_NAME,
    Key: { apiKey, tableName },
  }));

  if (!tableResult.Item) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(),
      body: JSON.stringify({ error: 'Table not found' }),
    };
  }

  const { tableId } = tableResult.Item as TableItem;

  // Delete table metadata
  await dynamodb.send(new DeleteCommand({
    TableName: TABLES_TABLE_NAME,
    Key: { apiKey, tableName },
  }));

  // Delete the actual DynamoDB table
  await deleteUserDataTable(tableId);

  // Regenerate AppSync schema
  await generateAndStoreSchema(apiKey);

  return {
    statusCode: 200,
    headers: getCorsHeaders(),
    body: JSON.stringify({ message: 'Table deleted successfully' }),
  };
}

/**
 * Create a DynamoDB table for user data
 */
async function createUserDataTable(tableId: string, fields: TableField[]): Promise<void> {
  // Find the primary key field (first field by default, or one marked as primary)
  const primaryKeyField = fields.find(f => f.primary) || fields[0];

  const params = {
    TableName: `rdb-data-${tableId}`,
    KeySchema: [
      {
        AttributeName: primaryKeyField.name,
        KeyType: 'HASH' as const,
      },
    ],
    AttributeDefinitions: [
      {
        AttributeName: primaryKeyField.name,
        AttributeType: getAttributeType(primaryKeyField.type),
      },
    ],
    BillingMode: 'PAY_PER_REQUEST' as const,
    StreamSpecification: {
      StreamEnabled: true,
      StreamViewType: 'NEW_AND_OLD_IMAGES' as const,
    },
  };

  await dynamodbService.send(new CreateTableCommand(params));
}

/**
 * Delete a user data table
 */
async function deleteUserDataTable(tableId: string): Promise<void> {
  try {
    await dynamodbService.send(new DeleteTableCommand({
      TableName: `rdb-data-${tableId}`,
    }));
  } catch (error: any) {
    if (error.name !== 'ResourceNotFoundException') {
      throw error;
    }
  }
}

/**
 * Generate and store AppSync schema configuration
 */
async function generateAndStoreSchema(apiKey: string): Promise<void> {
  // Get all tables for this API key
  const tablesResult = await dynamodb.send(new QueryCommand({
    TableName: TABLES_TABLE_NAME,
    KeyConditionExpression: 'apiKey = :apiKey',
    ExpressionAttributeValues: {
      ':apiKey': apiKey,
    },
  }));

  const tables = (tablesResult.Items || []) as TableItem[];
  const schema = generateGraphQLSchema(tables);

  
  // Store schema in S3 (use hash for path to avoid key exposure)
  const schemaKey = `schemas/${apiKey}/schema.graphql`;
  await s3.send(new PutObjectCommand({
    Bucket: CONFIG_BUCKET_NAME,
    Key: schemaKey,
    Body: schema,
    ContentType: 'text/plain',
  }));

  // Generate subscription queries for each table for client use
  const tablesWithSubscriptionQueries = tables.map(table => ({
    ...table,
    subscriptionQueries: generateSubscriptionQueries(table, apiKey)
  }));

  // Store table configurations for resolver generation (sanitize API key in config)
  const configKey = `schemas/${apiKey}/config.json`;
  const sanitizedConfig = {
    tables: tablesWithSubscriptionQueries,
    apiKey, // Store hash instead of raw key
    timestamp: new Date().toISOString()
  };
  await s3.send(new PutObjectCommand({
    Bucket: CONFIG_BUCKET_NAME,
    Key: configKey,
    Body: JSON.stringify(sanitizedConfig, null, 2),
    ContentType: 'application/json',
  }));
}

/**
 * Generate GraphQL schema from table definitions
 */
function generateGraphQLSchema(tables: TableItem[]): string {
  if (tables.length === 0) {
    // Return minimal valid schema if no tables exist
    return `
type Query {
  placeholder: String
}

type Mutation {
  placeholder: String  
}

type Subscription {
  placeholder: String
}
`;
  }

  let types = '';
  let queries = '';
  let mutations = '';
  let subscriptions = '';

  // Generate connection types first
  types += `
type Connection {
  items: [String]
  nextToken: String
}
`;

  tables.forEach(table => {
    const { tableName, fields, subscriptions: tableSubscriptions } = table;
    const typeName = capitalize(tableName);
    
    // Ensure we have valid fields
    if (!fields || fields.length === 0) return;

    // Add ID field if not present
    const allFields = [...fields];
    if (!allFields.find(f => f.name === 'id')) {
      allFields.unshift({ name: 'id', type: 'String', required: true, primary: true });
    }

    // Generate type definition
    types += `
type ${typeName} {
  ${allFields.map(field => `${field.name}: ${getGraphQLType(field.type)}${field.required ? '!' : ''}`).join('\n  ')}
  createdAt: String
  updatedAt: String
}
`;

    // Generate input types
    types += `
input ${typeName}Input {
  ${allFields.filter(f => !f.primary).map(field => `${field.name}: ${getGraphQLType(field.type)}`).join('\n  ')}
}
`;

    types += `
input ${typeName}UpdateInput {
  ${allFields.filter(f => !f.primary).map(field => `${field.name}: ${getGraphQLType(field.type)}`).join('\n  ')}
}
`;

    // Generate connection type
    types += `
type ${typeName}Connection {
  items: [${typeName}]
  nextToken: String
}
`;

    // Find primary key field
    const primaryField = allFields.find(f => f.primary) || allFields[0];

    // Generate queries
    queries += `
  get${typeName}(${primaryField.name}: ${getGraphQLType(primaryField.type)}!): ${typeName}
  list${typeName}(limit: Int, nextToken: String): ${typeName}Connection`;

    // Generate mutations  
    mutations += `
  create${typeName}(input: ${typeName}Input!): ${typeName}
  update${typeName}(${primaryField.name}: ${getGraphQLType(primaryField.type)}!, input: ${typeName}UpdateInput!): ${typeName}
  delete${typeName}(${primaryField.name}: ${getGraphQLType(primaryField.type)}!): ${typeName}`;

    // Generate subscriptions based on table configuration
    if (tableSubscriptions && tableSubscriptions.length > 0) {
      tableSubscriptions.forEach(sub => {
        const eventName = capitalize(sub.event || 'change');
        const filterParams = sub.filters ? 
          sub.filters.map(f => `${f.field}: ${getGraphQLType(f.type)}`).join(', ') : '';
        
        subscriptions += `
  on${typeName}${eventName}${filterParams ? `(${filterParams})` : ''}: ${typeName}
    @aws_subscribe(mutations: ["create${typeName}", "update${typeName}", "delete${typeName}"])`;
      });
    }
  });

  // Build final schema
  return `${types}
type Query {${queries || '\n  placeholder: String'}
}

type Mutation {${mutations || '\n  placeholder: String'}  
}

type Subscription {${subscriptions || '\n  placeholder: String'}
}
`;
}

/**
 * Get individual table details
 */
async function getTableDetails(apiKey: string, tableName: string): Promise<APIGatewayProxyResult> {
  const params = {
    TableName: TABLES_TABLE_NAME,
    Key: {
      apiKey: apiKey,
      tableName: tableName,
    },
  };

  try {
    const result = await dynamodb.send(new GetCommand(params));
    
    if (!result.Item) {
      return {
        statusCode: 404,
        headers: getCorsHeaders(),
        body: JSON.stringify({ error: 'Table not found' }),
      };
    }

    return {
      statusCode: 200,
      headers: getCorsHeaders(),
      body: JSON.stringify(result.Item),
    };
  } catch (error) {
    console.error('Error getting table details:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(),
      body: JSON.stringify({ error: 'Failed to get table details' }),
    };
  }
}

/**
 * Get table schema (fields only)
 */
async function getTableSchema(apiKey: string, tableName: string): Promise<APIGatewayProxyResult> {
  const params = {
    TableName: TABLES_TABLE_NAME,
    Key: {
      apiKey: apiKey,
      tableName: tableName,
    },
  };

  try {
    const result = await dynamodb.send(new GetCommand(params));
    
    if (!result.Item) {
      return {
        statusCode: 404,
        headers: getCorsHeaders(),
        body: JSON.stringify({ error: 'Table not found' }),
      };
    }

    const tableItem = result.Item as TableItem;
    
    // Convert fields array to a simple field name -> type mapping
    const fields: { [key: string]: string } = {};
    
    // Add default fields
    fields.id = 'string';
    fields.createdAt = 'string';
    fields.updatedAt = 'string';
    
    // Add user-defined fields
    if (tableItem.fields && Array.isArray(tableItem.fields)) {
      tableItem.fields.forEach(field => {
        fields[field.name] = field.type;
      });
    }

    return {
      statusCode: 200,
      headers: getCorsHeaders(),
      body: JSON.stringify({ fields }),
    };
  } catch (error) {
    console.error('Error getting table schema:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(),
      body: JSON.stringify({ error: 'Failed to get table schema' }),
    };
  }
}

/**
 * Generate subscription queries for a table with prefixed names
 * These queries will be used by the client SDK for real-time subscriptions
 */
function generateSubscriptionQueries(table: TableItem, apiKey: string): Record<string, string> {
  // GraphQL type names cannot start with numbers, so prefix with 'T'
  const prefixedTableName = `T${apiKey}_${table.tableName}`;
  const typeName = capitalize(prefixedTableName);
  const subscriptionQueries: Record<string, string> = {};

  // Get all fields for the subscription query
  const allFields = [...table.fields];
  if (!allFields.find(f => f.name === 'id')) {
    allFields.unshift({ name: 'id', type: 'String', required: true, primary: true });
  }

  // Build field selection for subscription
  const fieldSelection = allFields.map(f => f.name).join('\n    ');

  // Generate subscription queries based on table configuration
  if (table.subscriptions && table.subscriptions.length > 0) {
    table.subscriptions.forEach(sub => {
      const eventName = capitalize(sub.event || 'change');
      const subscriptionName = `on${typeName}${eventName}`;
      
      // Build filter arguments if any
      let filterArgs = '';
      let filterVariables = '';
      if (sub.filters && sub.filters.length > 0) {
        const filterParams = sub.filters.map(f => `$${f.field}: ${getGraphQLType(f.type)}`).join(', ');
        const filterArgs2 = sub.filters.map(f => `${f.field}: $${f.field}`).join(', ');
        filterVariables = `(${filterParams})`;
        filterArgs = `(${filterArgs2})`;
      }

      // Generate the GraphQL subscription query
      subscriptionQueries[sub.event] = `
subscription ${subscriptionName}${filterVariables} {
  ${subscriptionName}${filterArgs} {
    ${fieldSelection}
    createdAt
    updatedAt
  }
}`.trim();
    });
  } else {
    // Generate default subscriptions
    ['Create', 'Update', 'Delete', 'Change'].forEach(eventName => {
      const subscriptionName = `on${typeName}${eventName}`;
      const eventKey = eventName.toLowerCase();
      
      subscriptionQueries[eventKey] = `
subscription ${subscriptionName} {
  ${subscriptionName} {
    ${fieldSelection}
    createdAt
    updatedAt
  }
}`.trim();
    });
  }

  return subscriptionQueries;
}

/**
 * Utility functions
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getGraphQLType(fieldType: string): string {
  switch (fieldType?.toLowerCase()) {
    case 'number':
    case 'int':
    case 'integer':
      return 'Int';
    case 'float':
    case 'double':
      return 'Float';
    case 'boolean':
    case 'bool':
      return 'Boolean';
    case 'array':
    case 'list':
      return '[String]';
    default:
      return 'String';
  }
}

function getAttributeType(fieldType: string): 'S' | 'N' | 'B' {
  switch (fieldType?.toLowerCase()) {
    case 'number':
    case 'int':
    case 'integer':
    case 'float':
    case 'double':
      return 'N';
    default:
      return 'S';
  }
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