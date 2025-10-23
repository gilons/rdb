import { EventBridgeEvent, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { 
  AppSyncClient, 
  StartSchemaCreationCommand, 
  GetSchemaCreationStatusCommand,
  CreateDataSourceCommand,
  CreateResolverCommand,
  UpdateResolverCommand
} from '@aws-sdk/client-appsync';
import * as crypto from 'crypto';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const appSync = new AppSyncClient({ region: process.env.AWS_REGION || 'us-east-1' });

const CONFIG_BUCKET_NAME = process.env.CONFIG_BUCKET_NAME!;
const APPSYNC_API_ID = process.env.APPSYNC_API_ID!;

interface S3EventDetail {
  version: string;
  bucket: {
    name: string;
  };
  object: {
    key: string;
    size: number;
    etag: string;
  };
  'request-id': string;
  requester: string;
  'source-ip-address': string;
  reason: string;
}

/**
 * Lambda handler for AppSync schema synchronization
 * Triggered by EventBridge events when S3 schema configurations are updated
 */
export const handler = async (event: EventBridgeEvent<string, S3EventDetail>, context: Context): Promise<void> => {
  console.log('Schema sync event:', JSON.stringify(event, null, 2));

  try {
    // Check if this is an S3 object creation event
    if (event.source === 'aws.s3' && 
        (event['detail-type'] === 'Object Created' || event['detail-type'] === 'Object Removed')) {
      
      const bucketName = event.detail.bucket.name;
      let objectKey = event.detail.object.key;

      // Only process schema files
      if (objectKey.startsWith('schemas/') && objectKey.endsWith('/schema.graphql')) {
        console.log(`Processing schema update for: ${objectKey}`);
        await processSchemaUpdate(bucketName, objectKey);
      } else {
        console.log(`Skipping non-schema file: ${objectKey}`);
      }
    } else {
      console.log(`Skipping non-S3 or non-relevant event: ${event.source} - ${event['detail-type']}`);
    }
  } catch (error) {
    console.error('Error processing schema sync:', error);
    throw error;
  }
};

/**
 * Process schema update from S3
 */
async function processSchemaUpdate(bucketName: string, schemaKey: string): Promise<void> {
  try {
    // Extract API key from the schema path (schemas/{apiKey}/schema.graphql)
    const pathParts = schemaKey.split('/');
    if (pathParts.length < 3) {
      console.error('Invalid schema path format:', schemaKey);
      return;
    }

    // The path is schemas/{apiKeyHash}/schema.graphql, so pathParts[1] is already the hash
    const apiKeyHash = pathParts[1];
    console.log('Processing schema update for API key hash:', apiKeyHash);

    // Get the schema content from S3
    const schemaObject = await s3.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: schemaKey,
    }));

    if (!schemaObject.Body) {
      console.error('Empty schema file:', schemaKey);
      return;
    }

    const schemaContent = await schemaObject.Body.transformToString();

    // Get the table configuration
    const configKey = `schemas/${apiKeyHash}/config.json`;
    const configObject = await s3.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: configKey,
    }));

    if (!configObject.Body) {
      console.error('Missing config file for API key hash:', apiKeyHash);
      return;
    }

    const config = JSON.parse(await configObject.Body.transformToString());
    // Add apiKey hash to config for resolver creation
    config.apiKey = apiKeyHash;

    // Update AppSync schema
    await updateAppSyncSchema(apiKeyHash, config);

    console.log('Schema updated successfully for API key hash:', apiKeyHash);
  } catch (error) {
    console.error('Failed to process schema update:', error);
    throw error;
  }
}

/**
 * Update AppSync GraphQL schema by merging all schemas
 */
async function updateAppSyncSchema(apiKeyHash: string, config: any): Promise<void> {
  try {
    // Get all schemas from all API keys and merge them
    const unifiedSchema = await buildUnifiedSchema();

    console.log('Generated unified schema:', unifiedSchema);

    // Start schema creation with unified schema
    const startResult = await appSync.send(new StartSchemaCreationCommand({
      apiId: APPSYNC_API_ID,
      definition: Buffer.from(unifiedSchema),
    }));

    console.log('Schema creation started:', startResult);

    // Wait for schema creation to complete
    await waitForSchemaCreation();

    // Only create/update resolvers for the specific API key that was modified
    console.log(`Creating resolvers for apiKeyHash: ${apiKeyHash}, tables:`, JSON.stringify(config.tables, null, 2));
    await createResolversForApiKey(config.tables, apiKeyHash);

  } catch (error) {
    console.error('Failed to update AppSync schema:', error);
    throw error;
  }
}

/**
 * Build unified schema from all API key schemas
 */
async function buildUnifiedSchema(): Promise<string> {
  try {
    // List objects with schemas/ prefix to find all API key directories
    const listParams = {
      Bucket: CONFIG_BUCKET_NAME,
      Prefix: 'schemas/',
      Delimiter: '/'
    };

    const listResult: ListObjectsV2CommandOutput = await s3.send(new ListObjectsV2Command(listParams));
    const { CommonPrefixes } = listResult;
    
    const allTypes: string[] = [];
    const allInputs: string[] = [];
    const allQueries: string[] = [];
    const allMutations: string[] = [];
    const allSubscriptions: string[] = [];
    
    if (CommonPrefixes) {
      for (const prefix of CommonPrefixes) {
        if (!prefix.Prefix) continue;
        
        const apiKeyHash = prefix.Prefix.replace('schemas/', '').replace('/', '');
        if (!apiKeyHash) continue;

        try {
          // Get config for this API key
          const configKey = `schemas/${apiKeyHash}/config.json`;
          const configObject = await s3.send(new GetObjectCommand({
            Bucket: CONFIG_BUCKET_NAME,
            Key: configKey,
          }));

          if (!configObject.Body) continue;
          
          const config = JSON.parse(await configObject.Body.transformToString());
          
          // Generate schema parts for each table
          for (const table of config.tables) {
            console.log(`Generating schema for table: ${table.tableName}, API key hash: ${apiKeyHash}`);
            
            // Generate types, inputs, queries, mutations, subscriptions
            const { types, inputs, queries, mutations, subscriptions } = generateSchemaPartsForTable(table, apiKeyHash);
            
            console.log(`Generated queries for ${table.tableName}:`, queries);
            
            allTypes.push(...types);
            allInputs.push(...inputs);
            allQueries.push(...queries);
            allMutations.push(...mutations);
            allSubscriptions.push(...subscriptions);
          }
        } catch (error) {
          console.warn(`Failed to process schema for API key ${apiKeyHash}:`, error);
          // Continue with other API keys
        }
      }
    }

    // Build the unified schema
    const unifiedSchema = `
# RDB Unified GraphQL Schema
# Auto-generated from all table schemas

${allTypes.join('\n\n')}

${allInputs.join('\n\n')}

type Connection {
  items: [String]
  nextToken: String
}

type Query {
  placeholder: String
  ${allQueries.join('\n  ')}
}

type Mutation {
  placeholder: String
  ${allMutations.join('\n  ')}
}

type Subscription {
  placeholder: String
  ${allSubscriptions.join('\n  ')}
}
`;

    return unifiedSchema;
    
  } catch (error) {
    console.error('Failed to build unified schema:', error);
    throw error;
  }
}

/**
 * Generate schema parts for a single table
 */
function generateSchemaPartsForTable(table: any, apiKeyHash: string): {
  types: string[];
  inputs: string[];
  queries: string[];
  mutations: string[];
  subscriptions: string[];
} {
  // GraphQL type names cannot start with numbers, so prefix with 'T'
  const prefixedTableName = `T${apiKeyHash}_${table.tableName}`;
  const typeName = capitalize(prefixedTableName);
  const connectionName = `${typeName}Connection`;
  
  // Generate field definitions
  const fieldDefs = table.fields.map((field: any) => 
    `  ${field.name}: ${mapDynamoTypeToGraphQL(field.type)}${field.required ? '!' : ''}`
  ).join('\n');

  const inputFieldDefs = table.fields.map((field: any) => 
    `  ${field.name}: ${mapDynamoTypeToGraphQL(field.type)}`
  ).join('\n');

  // Get primary key field (first field or marked as primary)
  const primaryKeyField = table.fields.find((f: any) => f.primary) || table.fields[0];
  const pkType = mapDynamoTypeToGraphQL(primaryKeyField.type);

  const types = [
    `type ${typeName} {\n${fieldDefs}\n}`,
    `type ${connectionName} {\n  items: [${typeName}]\n  nextToken: String\n}`
  ];

  const inputs = [
    `input ${typeName}Input {\n${inputFieldDefs}\n}`,
    `input ${typeName}UpdateInput {\n${inputFieldDefs}\n}`
  ];

  const queries = [
    `get${typeName}(${primaryKeyField.name}: ${pkType}!): ${typeName}`,
    `list${typeName}(limit: Int, nextToken: String): ${connectionName}`
  ];

  const mutations = [
    `create${typeName}(input: ${typeName}Input!): ${typeName}`,
    `update${typeName}(${primaryKeyField.name}: ${pkType}!, input: ${typeName}UpdateInput!): ${typeName}`,
    `delete${typeName}(${primaryKeyField.name}: ${pkType}!): ${typeName}`
  ];

  // Generate subscription parts based on table subscriptions
  const subscriptions: string[] = [];
  if (table.subscriptions && table.subscriptions.length > 0) {
    for (const sub of table.subscriptions) {
      let filterArgs = '';
      if (sub.filters && sub.filters.length > 0) {
        const filterFields = sub.filters.map((filter: any) => 
          `${filter.field}: ${mapDynamoTypeToGraphQL(filter.type)}`
        ).join(', ');
        filterArgs = `(${filterFields})`;
      }

      subscriptions.push(
        `on${typeName}${capitalize(sub.event)}${filterArgs}: ${typeName}\n    @aws_subscribe(mutations: ["create${typeName}", "update${typeName}", "delete${typeName}"])`
      );
    }
  } else {
    // Default subscriptions
    subscriptions.push(
      `on${typeName}Create: ${typeName}\n    @aws_subscribe(mutations: ["create${typeName}", "update${typeName}", "delete${typeName}"])`,
      `on${typeName}Update: ${typeName}\n    @aws_subscribe(mutations: ["create${typeName}", "update${typeName}", "delete${typeName}"])`,
      `on${typeName}Delete: ${typeName}\n    @aws_subscribe(mutations: ["create${typeName}", "update${typeName}", "delete${typeName}"])`,
      `on${typeName}Change: ${typeName}\n    @aws_subscribe(mutations: ["create${typeName}", "update${typeName}", "delete${typeName}"])`
    );
  }

  return { types, inputs, queries, mutations, subscriptions };
}

/**
 * Map DynamoDB types to GraphQL types
 */
function mapDynamoTypeToGraphQL(dynamoType: string): string {
  switch (dynamoType.toLowerCase()) {
    case 'string': return 'String';
    case 'number':
    case 'float': return 'Float';
    case 'int':
    case 'integer': return 'Int';
    case 'boolean':
    case 'bool': return 'Boolean';
    case 'list':
    case 'array': return '[String]';
    default: return 'String';
  }
}



/**
 * Create resolvers for tables of a specific API key
 */
async function createResolversForApiKey(tables: any[], apiKeyHash: string): Promise<void> {
  console.log(`Creating resolvers for API key hash: ${apiKeyHash}, tables count: ${tables.length}`);
  
  for (const table of tables) {
    // GraphQL type names cannot start with numbers, so prefix with 'T'
    const prefixedTableName = `T${apiKeyHash}_${table.tableName}`;
    const typeName = capitalize(prefixedTableName);
    const dataSource = `rdb_data_${apiKeyHash}_${table.tableName}`;

    console.log(`Processing table: ${table.tableName}, typeName: ${typeName}, dataSource: ${dataSource}`);

    try {
      // Create data source for the table if it doesn't exist
      await createDataSource(table.tableId, dataSource);

      // Create resolvers for queries
      console.log(`Creating resolver: Query.get${typeName}`);
      await createResolver(`Query`, `get${typeName}`, dataSource, 'get');
      console.log(`Creating resolver: Query.list${typeName}`);
      await createResolver(`Query`, `list${typeName}`, dataSource, 'list');

      // Create resolvers for mutations
      await createResolver(`Mutation`, `create${typeName}`, dataSource, 'create');
      await createResolver(`Mutation`, `update${typeName}`, dataSource, 'update');
      await createResolver(`Mutation`, `delete${typeName}`, dataSource, 'delete');

    } catch (error) {
      console.error(`Failed to create resolvers for table ${table.tableName} (${apiKeyHash}):`, error);
      // Continue with other tables
    }
  }
}

/**
 * Wait for schema creation to complete
 */
async function waitForSchemaCreation(): Promise<void> {
  const maxRetries = 30;
  const retryDelay = 2000; // 2 seconds

  for (let i = 0; i < maxRetries; i++) {
    try {
      const status = await appSync.send(new GetSchemaCreationStatusCommand({
        apiId: APPSYNC_API_ID,
      }));

      console.log('Schema creation status:', status.status);

      if (status.status === 'SUCCESS') {
        return;
      }

      if (status.status === 'FAILED') {
        throw new Error(`Schema creation failed: ${status.details}`);
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    } catch (error) {
      console.error('Error checking schema status:', error);
      throw error;
    }
  }

  throw new Error('Schema creation timeout');
}



/**
 * Create AppSync data source
 */
async function createDataSource(tableId: string, dataSourceName: string): Promise<void> {
  const tableName = `rdb-data-${tableId}`;

  console.log(`Creating data source: ${dataSourceName} for table: ${tableName}`);

  try {
    await appSync.send(new CreateDataSourceCommand({
      apiId: APPSYNC_API_ID,
      name: dataSourceName,
      type: 'AMAZON_DYNAMODB',
      dynamodbConfig: {
        tableName: tableName,
        awsRegion: process.env.AWS_REGION || 'us-east-1',
      },
      serviceRoleArn: process.env.APPSYNC_SERVICE_ROLE_ARN!
    }));
    console.log(`Data source ${dataSourceName} created successfully`);
  } catch (error: any) {
    // Handle both ConflictException and BadRequestException for existing data sources
    if (error.name === 'ConflictException' || 
        (error.name === 'BadRequestException' && error.message?.includes('already exists'))) {
      console.log(`Data source ${dataSourceName} already exists, skipping creation`);
      return;
    }
    throw error;
  }
}

/**
 * Create AppSync resolver
 */
async function createResolver(
  typeName: string,
  fieldName: string,
  dataSourceName: string,
  operation: string
): Promise<void> {
  const requestTemplate = generateRequestTemplate(operation);
  const responseTemplate = generateResponseTemplate(operation);

  try {
    await appSync.send(new CreateResolverCommand({
      apiId: APPSYNC_API_ID,
      typeName,
      fieldName,
      dataSourceName,
      requestMappingTemplate: requestTemplate,
      responseMappingTemplate: responseTemplate,
    }));
  } catch (error: any) {
    if (error.name === 'ConflictException') {
      // Update existing resolver
      await appSync.send(new UpdateResolverCommand({
        apiId: APPSYNC_API_ID,
        typeName,
        fieldName,
        dataSourceName,
        requestMappingTemplate: requestTemplate,
        responseMappingTemplate: responseTemplate,
      }));
    } else {
      throw error;
    }
  }
}

/**
 * Generate VTL request template for DynamoDB operations
 */
function generateRequestTemplate(operation: string): string {
  switch (operation) {
    case 'get':
      return `
{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    #foreach($entry in $ctx.args.entrySet())
      "$entry.key": $util.dynamodb.toDynamoDBValue($entry.value)#if($foreach.hasNext),#end
    #end
  }
}`;

    case 'list':
      return `
{
  "version": "2017-02-28",
  "operation": "Scan",
  #if($ctx.args.limit)
    "limit": $ctx.args.limit,
  #end
  #if($ctx.args.nextToken)
    "nextToken": "$ctx.args.nextToken",
  #end
}`;

    case 'create':
      return `
{
  "version": "2017-02-28",
  "operation": "PutItem",
  "key": {
    #foreach($entry in $ctx.args.input.entrySet())
      #if($velocityCount == 1)
        "$entry.key": $util.dynamodb.toDynamoDBValue($entry.value)
        #break
      #end
    #end
  },
  "attributeValues": $util.dynamodb.toMapValues($ctx.args.input)
}`;

    case 'update':
      return `
{
  "version": "2017-02-28",
  "operation": "UpdateItem",
  "key": {
    #foreach($entry in $ctx.args.entrySet())
      #if($entry.key != "input")
        "$entry.key": $util.dynamodb.toDynamoDBValue($entry.value)#if($foreach.hasNext),#end
      #end
    #end
  },
  "update": {
    "expression": "SET #updatedAt = :updatedAt",
    "expressionNames": {
      "#updatedAt": "updatedAt"
    },
    "expressionValues": {
      ":updatedAt": $util.dynamodb.toDynamoDBValue($util.time.nowISO8601())
    }
  }
}`;

    case 'delete':
      return `
{
  "version": "2017-02-28",
  "operation": "DeleteItem",
  "key": {
    #foreach($entry in $ctx.args.entrySet())
      "$entry.key": $util.dynamodb.toDynamoDBValue($entry.value)#if($foreach.hasNext),#end
    #end
  }
}`;

    default:
      return '{}';
  }
}

/**
 * Generate VTL response template
 */
function generateResponseTemplate(operation: string): string {
  switch (operation) {
    case 'list':
      return `
{
  "items": $util.toJson($ctx.result.items),
  "nextToken": #if($ctx.result.nextToken) "$ctx.result.nextToken" #else null #end
}`;

    default:
      return '$util.toJson($ctx.result)';
  }
}

/**
 * Utility functions
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Generate a consistent hash for API key (for logging and identification)
 * This ensures API keys are never exposed in logs
 */
function getApiKeyHash(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 8);
}