import { EventBridgeEvent, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand, ListObjectsV2Command, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { 
  updateAppSyncSchema, 
  createDataSource, 
  createTableResolvers,
  createNoneDataSource,
  createPublishResolver
} from '../../utils/appsync-utils';
import { capitalize, getGraphQLType } from '../../utils';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const CONFIG_BUCKET_NAME = process.env.CONFIG_BUCKET_NAME!;

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
    await processSchemaUpdateAndSync(apiKeyHash, config);

    console.log('Schema updated successfully for API key hash:', apiKeyHash);
  } catch (error) {
    console.error('Failed to process schema update:', error);
    throw error;
  }
}

/**
 * Process schema update and sync with AppSync
 */
async function processSchemaUpdateAndSync(apiKeyHash: string, config: any): Promise<void> {
  try {
    // Get all schemas from all API keys and merge them
    const unifiedSchema = await buildUnifiedSchema();

    console.log('Generated unified schema (first 500 chars):', unifiedSchema.substring(0, 500));

    // Update AppSync schema using shared utility
    await updateAppSyncSchema(unifiedSchema);

    // Only create/update resolvers for the specific API key that was modified
    console.log(`Creating resolvers for apiKeyHash: ${apiKeyHash}, tables count: ${config.tables.length}`);
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
    `  ${field.name}: ${getGraphQLType(field.type)}${field.required ? '!' : ''}`
  ).join('\n');

  const inputFieldDefs = table.fields.map((field: any) => 
    `  ${field.name}: ${getGraphQLType(field.type)}`
  ).join('\n');

  // Get primary key field (first field or marked as primary)
  const primaryKeyField = table.fields.find((f: any) => f.primary)
  const pkType = getGraphQLType(primaryKeyField.type);

  const types = [
    `type ${typeName} {\n${fieldDefs}\n}`,
    `type ${connectionName} {\n  items: [${typeName}]\n  nextToken: String\n}`
  ];

  const inputs = [
    `input ${typeName}Input {\n${inputFieldDefs}\n}`,
    `input ${typeName}UpdateInput {\n${inputFieldDefs}\n}`
  ];

  // Generate filter parameters for indexed fields (for efficient queries without scans)
  const indexedFields = table.fields.filter((f: any) => f.indexed && !f.primary);
  const filterParams = indexedFields.length > 0
    ? indexedFields.map((f: any) => `${f.name}: ${getGraphQLType(f.type)}`).join(', ') + ', '
    : '';

  const queries = [
    `get${typeName}(${primaryKeyField.name}: ${pkType}!): ${typeName}`,
    `list${typeName}(${filterParams}limit: Int, nextToken: String): ${connectionName}`
  ];

  const mutations = [
    `create${typeName}(input: ${typeName}Input!): ${typeName}`,
    `update${typeName}(${primaryKeyField.name}: ${pkType}!, input: ${typeName}UpdateInput!): ${typeName}`,
    `delete${typeName}(${primaryKeyField.name}: ${pkType}!): ${typeName}`,
    // Direct publish mutation - bypasses DynamoDB for fast real-time streaming
    `publish${typeName}(input: ${typeName}Input!): ${typeName}`
  ];

  // Generate subscription parts - ALWAYS create onCreate, onUpdate, onDelete
  // Each subscription listens ONLY to its corresponding mutation
  const subscriptions: string[] = [];
  
  // Get filter arguments if specified
  let filterArgs = '';
  if (table.subscriptions && table.subscriptions.length > 0) {
    const sub = table.subscriptions[0]; // Use first subscription config for filters
    if (sub.filters && sub.filters.length > 0) {
      const filterFields = sub.filters.map((filter: any) => 
        `${filter.field}: ${getGraphQLType(filter.type)}`
      ).join(', ');
      filterArgs = `(${filterFields})`;
    }
  }
  
  // Generate subscriptions - publish mutation triggers the Update subscription for streaming
  subscriptions.push(
    `on${typeName}Create${filterArgs}: ${typeName}\n    @aws_subscribe(mutations: ["create${typeName}"])`,
    `on${typeName}Update${filterArgs}: ${typeName}\n    @aws_subscribe(mutations: ["update${typeName}", "publish${typeName}"])`,
    `on${typeName}Delete${filterArgs}: ${typeName}\n    @aws_subscribe(mutations: ["delete${typeName}"])`
  );

  return { types, inputs, queries, mutations, subscriptions };
}

/**
 * Create resolvers for tables of a specific API key
 */
async function createResolversForApiKey(tables: any[], apiKeyHash: string): Promise<void> {
  console.log(`Creating resolvers for API key hash: ${apiKeyHash}, tables count: ${tables.length}`);
  
  // Create NONE data source for direct publish (shared across all tables)
  try {
    await createNoneDataSource('NONE_DS');
  } catch (error) {
    console.error('Failed to create NONE data source:', error);
    // Continue - it may already exist
  }
  
  for (const table of tables) {
    // GraphQL type names cannot start with numbers, so prefix with 'T'
    const prefixedTableName = `T${apiKeyHash}_${table.tableName}`;
    const typeName = capitalize(prefixedTableName);
    const dataSourceName = `rdb_data_${apiKeyHash}_${table.tableName}`;

    console.log(`Processing table: ${table.tableName}, typeName: ${typeName}, dataSource: ${dataSourceName}`);

    try {
      // Create data source for the table if it doesn't exist
      await createDataSource(table.tableId, dataSourceName);

      // Create all resolvers using shared utility
      await createTableResolvers(table, apiKeyHash, typeName, dataSourceName);

      // Create publish resolver (uses NONE data source for fast streaming)
      await createPublishResolver(typeName, `publish${typeName}`, 'NONE_DS');

    } catch (error) {
      console.error(`Failed to create resolvers for table ${table.tableName} (${apiKeyHash}):`, error);
      // Continue with other tables
    }
  }
}


