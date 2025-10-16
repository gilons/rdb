import { S3Event, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
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

/**
 * Lambda handler for AppSync schema synchronization
 * Triggered by S3 events when schema configurations are updated
 */
export const handler = async (event: S3Event, context: Context): Promise<void> => {
  console.log('Schema sync event:', JSON.stringify(event, null, 2));

  try {
    for (const record of event.Records) {
      if (record.eventName?.startsWith('ObjectCreated') || record.eventName?.startsWith('ObjectRemoved')) {
        const bucketName = record.s3.bucket.name;
        const objectKey = record.s3.object.key;

        if (objectKey.startsWith('schemas/') && objectKey.endsWith('/schema.graphql')) {
          await processSchemaUpdate(bucketName, objectKey);
        }
      }
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

    const apiKeyOrHash = pathParts[1];
    const apiKeyHash = getApiKeyHash(apiKeyOrHash);
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
    const configKey = `schemas/${apiKeyOrHash}/config.json`;
    const configObject = await s3.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: configKey,
    }));

    if (!configObject.Body) {
      console.error('Missing config file for API key hash:', apiKeyHash);
      return;
    }

    const config = JSON.parse(await configObject.Body.transformToString());

    // Update AppSync schema
    await updateAppSyncSchema(schemaContent, config);

    console.log('Schema updated successfully for API key hash:', apiKeyHash);
  } catch (error) {
    console.error('Failed to process schema update:', error);
    throw error;
  }
}

/**
 * Update AppSync GraphQL schema
 */
async function updateAppSyncSchema(schemaContent: string, config: any): Promise<void> {
  try {
    console.log('Generic schema is used - no dynamic schema updates needed');
    console.log('Creating/updating resolvers for table operations...');

    // With generic schema, we only need to ensure resolvers are properly configured
    // The schema itself never changes - it handles all table structures generically
    await createGenericResolvers();

  } catch (error) {
    console.error('Failed to update AppSync resolvers:', error);
    throw error;
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
 * Create generic resolvers that work with any table structure
 */
async function createGenericResolvers(): Promise<void> {
  const dataSourceName = 'RdbGenericDataSource';

  try {
    // Create a generic data source that can work with any table
    await createGenericDataSource(dataSourceName);

    // Create resolvers for generic operations
    await createResolver('Query', 'getRecord', dataSourceName, 'getRecord');
    await createResolver('Query', 'listRecords', dataSourceName, 'listRecords');
    await createResolver('Query', 'getTable', dataSourceName, 'getTable');
    await createResolver('Query', 'listTables', dataSourceName, 'listTables');

    // Create resolvers for mutations
    await createResolver('Mutation', 'createRecord', dataSourceName, 'createRecord');
    await createResolver('Mutation', 'updateRecord', dataSourceName, 'updateRecord');
    await createResolver('Mutation', 'deleteRecord', dataSourceName, 'deleteRecord');
    await createResolver('Mutation', 'batchCreateRecords', dataSourceName, 'batchCreateRecords');
    await createResolver('Mutation', 'batchUpdateRecords', dataSourceName, 'batchUpdateRecords');
    await createResolver('Mutation', 'batchDeleteRecords', dataSourceName, 'batchDeleteRecords');

    console.log('Generic resolvers created successfully');

  } catch (error) {
    console.error('Failed to create generic resolvers:', error);
    throw error;
  }
}

/**
 * Create AppSync data source
 */
async function createDataSource(tableId: string, dataSourceName: string): Promise<void> {
  const tableName = `rdb-data-${tableId}`;

  try {
    await appSync.send(new CreateDataSourceCommand({
      apiId: APPSYNC_API_ID,
      name: dataSourceName,
      type: 'AMAZON_DYNAMODB',
      dynamodbConfig: {
        tableName: tableName,
        awsRegion: process.env.AWS_REGION || 'us-east-1',
      },
      serviceRoleArn: process.env.APPSYNC_SERVICE_ROLE_ARN || '', // This would need to be configured
    }));
  } catch (error: any) {
    if (error.name !== 'ConflictException') {
      throw error;
    }
    // Data source already exists
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