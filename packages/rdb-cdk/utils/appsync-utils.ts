/**
 * Shared utilities for AppSync operations
 * Used by schema-sync and other lambdas that interact with AppSync
 */

import {
  AppSyncClient,
  CreateDataSourceCommand,
  CreateResolverCommand,
  UpdateResolverCommand,
  DeleteResolverCommand,
  DeleteDataSourceCommand,
  ListResolversCommand,
  StartSchemaCreationCommand,
  GetSchemaCreationStatusCommand
} from '@aws-sdk/client-appsync';

// Initialize AppSync client
const appSync = new AppSyncClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Environment variables
const APPSYNC_API_ID = process.env.APPSYNC_API_ID!;
const APPSYNC_SERVICE_ROLE_ARN = process.env.APPSYNC_SERVICE_ROLE_ARN!;

/**
 * Create AppSync data source for a DynamoDB table
 */
export async function createDataSource(tableId: string, dataSourceName: string): Promise<void> {
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
      serviceRoleArn: APPSYNC_SERVICE_ROLE_ARN
    }));
    console.log(`✓ Data source ${dataSourceName} created successfully`);
  } catch (error: any) {
    if (error.name === 'ConflictException' || 
        (error.name === 'BadRequestException' && error.message?.includes('already exists'))) {
      console.log(`✓ Data source ${dataSourceName} already exists`);
      return;
    }
    throw error;
  }
}

/**
 * Delete AppSync data source
 */
export async function deleteDataSource(dataSourceName: string): Promise<void> {
  try {
    await appSync.send(new DeleteDataSourceCommand({
      apiId: APPSYNC_API_ID,
      name: dataSourceName,
    }));
    console.log(`✓ Deleted data source: ${dataSourceName}`);
  } catch (error: any) {
    if (error.name === 'NotFoundException') {
      console.log(`Data source ${dataSourceName} not found, skipping`);
      return;
    }
    throw error;
  }
}

/**
 * Create or update AppSync resolver
 */
export async function createOrUpdateResolver(
  typeName: string,
  fieldName: string,
  dataSourceName: string,
  operation: string,
  primaryKeyField?: string,
  indexedFields?: string[]
): Promise<void> {
  const requestTemplate = generateRequestTemplate(operation, primaryKeyField, indexedFields);
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
    console.log(`✓ Created resolver: ${typeName}.${fieldName}`);
  } catch (error: any) {
    if (error.name === 'ConflictException' || 
        (error.name === 'BadRequestException' && error.message?.includes('Only one resolver'))) {
      // Update existing resolver
      await appSync.send(new UpdateResolverCommand({
        apiId: APPSYNC_API_ID,
        typeName,
        fieldName,
        dataSourceName,
        requestMappingTemplate: requestTemplate,
        responseMappingTemplate: responseTemplate,
      }));
      console.log(`✓ Updated resolver: ${typeName}.${fieldName}`);
    } else {
      throw error;
    }
  }
}

/**
 * Delete AppSync resolver
 */
export async function deleteResolver(typeName: string, fieldName: string): Promise<void> {
  try {
    await appSync.send(new DeleteResolverCommand({
      apiId: APPSYNC_API_ID,
      typeName,
      fieldName,
    }));
    console.log(`✓ Deleted resolver: ${typeName}.${fieldName}`);
  } catch (error: any) {
    if (error.name === 'NotFoundException') {
      console.log(`Resolver ${typeName}.${fieldName} not found, skipping`);
      return;
    }
    throw error;
  }
}

/**
 * Delete all resolvers for a specific table
 */
export async function deleteTableResolvers(typeName: string): Promise<void> {
  console.log(`Deleting all resolvers for type: ${typeName}`);

  // Query resolvers
  await deleteResolver('Query', `get${typeName}`);
  await deleteResolver('Query', `list${typeName}`);

  // Mutation resolvers
  await deleteResolver('Mutation', `create${typeName}`);
  await deleteResolver('Mutation', `update${typeName}`);
  await deleteResolver('Mutation', `delete${typeName}`);
}

/**
 * Update AppSync GraphQL schema
 */
export async function updateAppSyncSchema(schemaContent: string): Promise<void> {
  console.log('Starting schema update...');
  
  // Start schema creation
  const startResult = await appSync.send(new StartSchemaCreationCommand({
    apiId: APPSYNC_API_ID,
    definition: Buffer.from(schemaContent),
  }));

  console.log('Schema creation started:', startResult.status);

  // Wait for schema creation to complete
  await waitForSchemaCreation();
  
  console.log('✓ Schema updated successfully');
}

/**
 * Wait for schema creation to complete
 */
async function waitForSchemaCreation(): Promise<void> {
  const maxRetries = 30;
  const retryDelay = 2000; // 2 seconds

  for (let i = 0; i < maxRetries; i++) {
    const status = await appSync.send(new GetSchemaCreationStatusCommand({
      apiId: APPSYNC_API_ID,
    }));

    console.log(`Schema creation status (${i + 1}/${maxRetries}):`, status.status);

    if (status.status === 'SUCCESS') {
      return;
    }

    if (status.status === 'FAILED') {
      throw new Error(`Schema creation failed: ${status.details}`);
    }

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }

  throw new Error('Schema creation timeout');
}

/**
 * Create resolvers for all operations of a table
 */
export async function createTableResolvers(
  table: any,
  apiKeyHash: string,
  typeName: string,
  dataSourceName: string
): Promise<void> {
  console.log(`Creating resolvers for table: ${table.tableName}, type: ${typeName}`);

  // Get primary key field
  const primaryKeyField = table.fields.find((f: any) => f.primary) || table.fields[0];

  // Get indexed fields (excluding primary key)
  const indexedFields = table.fields
    .filter((f: any) => f.indexed && !f.primary)
    .map((f: any) => f.name);

  // Create resolvers for queries
  await createOrUpdateResolver('Query', `get${typeName}`, dataSourceName, 'get', primaryKeyField.name);
  await createOrUpdateResolver('Query', `list${typeName}`, dataSourceName, 'list', primaryKeyField.name, indexedFields);

  // Create resolvers for mutations
  await createOrUpdateResolver('Mutation', `create${typeName}`, dataSourceName, 'create', primaryKeyField.name);
  await createOrUpdateResolver('Mutation', `update${typeName}`, dataSourceName, 'update', primaryKeyField.name);
  await createOrUpdateResolver('Mutation', `delete${typeName}`, dataSourceName, 'delete', primaryKeyField.name);

  console.log(`✓ All resolvers created for ${typeName}`);
}

/**
 * Generate VTL request template for DynamoDB operations
 */
function generateRequestTemplate(operation: string, primaryKeyField?: string, indexedFields?: string[]): string {
  const pkField = primaryKeyField || 'id';
  
  switch (operation) {
    case 'get':
      return `{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": $util.dynamodb.toMapValuesJson($ctx.args)
}`;

    case 'list':
      // Generate smart list query that uses Query with GSI when filter parameters are provided
      // Falls back to Scan when no filters are present
      if (indexedFields && indexedFields.length > 0) {
        return `## Smart list resolver: Uses Query with GSI when filter is provided, Scan otherwise
${indexedFields.map((field, index) => 
  index === 0 
    ? `#if($ctx.args.${field})
  {
    "version": "2017-02-28",
    "operation": "Query",
    "index": "${field}-index",
    "query": {
      "expression": "#${field} = :${field}",
      "expressionNames": {
        "#${field}": "${field}"
      },
      "expressionValues": {
        ":${field}": $util.dynamodb.toDynamoDBJson($ctx.args.${field})
      }
    }
    #if($ctx.args.limit)
      ,"limit": $ctx.args.limit
    #end
    #if($ctx.args.nextToken)
      ,"nextToken": "$ctx.args.nextToken"
    #end
  }`
    : `#elseif($ctx.args.${field})
  {
    "version": "2017-02-28",
    "operation": "Query",
    "index": "${field}-index",
    "query": {
      "expression": "#${field} = :${field}",
      "expressionNames": {
        "#${field}": "${field}"
      },
      "expressionValues": {
        ":${field}": $util.dynamodb.toDynamoDBJson($ctx.args.${field})
      }
    }
    #if($ctx.args.limit)
      ,"limit": $ctx.args.limit
    #end
    #if($ctx.args.nextToken)
      ,"nextToken": "$ctx.args.nextToken"
    #end
  }`
).join('\n')}
#else
  {
    "version": "2017-02-28",
    "operation": "Scan"
    #if($ctx.args.limit)
      ,"limit": $ctx.args.limit
    #end
    #if($ctx.args.nextToken)
      ,"nextToken": "$ctx.args.nextToken"
    #end
  }
#end`;
      } else {
        // No indexed fields, always use Scan
        return `{
  "version": "2017-02-28",
  "operation": "Scan"
  #if($ctx.args.limit)
    ,"limit": $ctx.args.limit
  #end
  #if($ctx.args.nextToken)
    ,"nextToken": "$ctx.args.nextToken"
  #end
}`;
      }

    case 'create':
      return `{
  "version": "2017-02-28",
  "operation": "PutItem",
  "key": {
    "${pkField}": $util.dynamodb.toDynamoDBJson($ctx.args.input.${pkField})
  },
  "attributeValues": $util.dynamodb.toMapValuesJson($ctx.args.input)
}`;

    case 'update':
      return `## --- Collect key fields ---
#set($keyArgs = {})
#foreach($entry in $ctx.args.entrySet())
  #if($entry.key != "input")
    #set($discard = $keyArgs.put($entry.key, $entry.value))
  #end
#end

## --- Collect update fields ---
#set($updateArgs = {})
#if($ctx.args.input)
  #set($updateArgs = $ctx.args.input)
#end
#set($discard = $updateArgs.put("updatedAt", $util.time.nowISO8601()))

## --- Build update expression manually ---
#set($updateExpression = "SET")
#set($first = true)
#foreach($key in $updateArgs.keySet())
  #if($first)
    #set($updateExpression = "$updateExpression #$key = :$key")
    #set($first = false)
  #else
    #set($updateExpression = "$updateExpression, #$key = :$key")
  #end
#end

{
  "version": "2017-02-28",
  "operation": "UpdateItem",
  
  "key": {
    #foreach($key in $keyArgs.keySet())
      "$key": $util.dynamodb.toDynamoDBJson($keyArgs.get($key))#if($foreach.hasNext),#end
    #end
  },
  
  "update": {
    "expression": "$updateExpression",
    "expressionNames": {
      #foreach($key in $updateArgs.keySet())
        "#$key": "$key"#if($foreach.hasNext),#end
      #end
    },
    "expressionValues": {
      #foreach($key in $updateArgs.keySet())
        ":$key": $util.dynamodb.toDynamoDBJson($updateArgs.get($key))#if($foreach.hasNext),#end
      #end
    }
  },
  
  "condition": {
    "expression": "attribute_exists(#partitionKey)",
    "expressionNames": {
      "#partitionKey": "$` + `{keyArgs.keySet().toArray()[0]}"
    }
  }
}`;

    case 'delete':
      return `{
  "version": "2017-02-28",
  "operation": "DeleteItem",
  "key": $util.dynamodb.toMapValuesJson($ctx.args)
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
