/**
 * Shared utilities for GraphQL schema generation and S3 management
 * Used by table-managements and table-decommission lambdas
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { TableItem } from '../types';
import { capitalize, getGraphQLType } from '.';

// Initialize AWS clients
const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// Environment variables
const TABLES_TABLE_NAME = process.env.TABLES_TABLE_NAME!;
const CONFIG_BUCKET_NAME = process.env.CONFIG_BUCKET_NAME!;

/**
 * Generate GraphQL schema from table definitions
 */
export function generateGraphQLSchema(tables: TableItem[], apiKey: string): string {
  if (tables.length === 0) {
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


  tables.forEach(table => {
    const { tableName, fields, subscriptions: tableSubscriptions } = table;
    const prefixedTableName = `T${apiKey}_${tableName}`;
    const typeName = capitalize(prefixedTableName);
    
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

    // Generate filter parameters for indexed fields (for efficient queries without scans)
    const indexedFields = allFields.filter(f => f.indexed && !f.primary);
    const filterParams = indexedFields.length > 0
      ? indexedFields.map(f => `${f.name}: ${getGraphQLType(f.type)}`).join(', ') + ', '
      : '';

    // Generate queries
    queries += `
  get${typeName}(${primaryField.name}: ${getGraphQLType(primaryField.type)}!): ${typeName}
  list${typeName}(${filterParams}limit: Int, nextToken: String): ${typeName}Connection`;

    // Generate mutations  
    mutations += `
  create${typeName}(input: ${typeName}Input!): ${typeName}
  update${typeName}(${primaryField.name}: ${getGraphQLType(primaryField.type)}!, input: ${typeName}UpdateInput!): ${typeName}
  delete${typeName}(${primaryField.name}: ${getGraphQLType(primaryField.type)}!): ${typeName}`;

    // Generate subscriptions (3 separate subscriptions: onCreate, onUpdate, onDelete)
    if (tableSubscriptions && tableSubscriptions.length > 0) {
      const sub = tableSubscriptions[0]; // Use first subscription config for all three events
      const filterParams = sub.filters ? 
        sub.filters.map(f => `${f.field}: ${getGraphQLType(f.type)}`).join(', ') : '';
      
      // Create separate subscription for each event type
      ['Create', 'Update', 'Delete'].forEach(eventName => {
        subscriptions += `
  on${typeName}${eventName}${filterParams ? `(${filterParams})` : ''}: ${typeName}
    @aws_subscribe(mutations: ["${eventName.toLowerCase()}${typeName}"])`;
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
 * Generate subscription queries for a table
 */
export function generateSubscriptionQueries(table: TableItem, apiKey: string): any {
  const subscriptionQueries: any = {};
  
  if (!table.subscriptions || table.subscriptions.length === 0) {
    return subscriptionQueries;
  }

  const prefixedTableName = `T${apiKey}_${table.tableName}`;
  const typeName = capitalize(prefixedTableName);

  const sub = table.subscriptions[0]; // Use first subscription config for filter parameters
  
  let filterArgs = '';
  let filterVars = '';
  if (sub.filters && sub.filters.length > 0) {
    const filterDefs = sub.filters.map(f => `$${f.field}: ${getGraphQLType(f.type)}`).join(', ');
    const filterParams = sub.filters.map(f => `${f.field}: $${f.field}`).join(', ');
    filterArgs = `(${filterDefs})`;
    filterVars = `(${filterParams})`;
  }

  // Generate 3 separate subscription queries: onCreate, onUpdate, onDelete
  ['Create', 'Update', 'Delete'].forEach(eventName => {
    const queryName = `on${typeName}${eventName}`;
    subscriptionQueries[queryName] = `
subscription ${queryName}${filterArgs} {
  ${queryName}${filterVars} {
    ${table.fields.map(f => f.name).join('\n    ')}
    createdAt
    updatedAt
  }
}`.trim();
  });

  return subscriptionQueries;
}

/**
 * Generate and store AppSync schema configuration in S3
 * This function handles both creation and deletion of schemas
 */
export async function generateAndStoreSchema(apiKey: string): Promise<void> {
  // Query all tables for this API key
  const tablesResult = await dynamodb.send(new QueryCommand({
    TableName: TABLES_TABLE_NAME,
    KeyConditionExpression: 'apiKey = :apiKey',
    ExpressionAttributeValues: {
      ':apiKey': apiKey,
    },
  }));

  const tables = (tablesResult.Items || []) as TableItem[];

  // If no tables left for this API key, delete the schema and config files
  if (tables.length === 0) {
    console.log(`No tables remaining for API key, deleting schema and config files`);
    
    const schemaKey = `schemas/${apiKey}/schema.graphql`;
    const configKey = `schemas/${apiKey}/config.json`;
    
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: CONFIG_BUCKET_NAME,
        Key: schemaKey,
      }));
      console.log(`✓ Deleted schema file: ${schemaKey}`);
    } catch (error: any) {
      if (error.name !== 'NoSuchKey') {
        console.warn(`Failed to delete schema file:`, error.message);
      }
    }
    
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: CONFIG_BUCKET_NAME,
        Key: configKey,
      }));
      console.log(`✓ Deleted config file: ${configKey}`);
    } catch (error: any) {
      if (error.name !== 'NoSuchKey') {
        console.warn(`Failed to delete config file:`, error.message);
      }
    }
    
    return;
  }

  // Generate schema with remaining tables
  console.log(`Generating schema with ${tables.length} table(s)`);
  
  const schema = generateGraphQLSchema(tables, apiKey);
  
  // Store schema in S3
  const schemaKey = `schemas/${apiKey}/schema.graphql`;
  await s3.send(new PutObjectCommand({
    Bucket: CONFIG_BUCKET_NAME,
    Key: schemaKey,
    Body: schema,
    ContentType: 'text/plain',
  }));
  console.log(`✓ Stored schema file: ${schemaKey}`);

  // Generate subscription queries for each table
  const tablesWithSubscriptionQueries = tables.map(table => ({
    ...table,
    subscriptionQueries: generateSubscriptionQueries(table, apiKey)
  }));

  // Store table configurations
  const configKey = `schemas/${apiKey}/config.json`;
  const sanitizedConfig = {
    tables: tablesWithSubscriptionQueries,
    apiKey,
    timestamp: new Date().toISOString()
  };
  await s3.send(new PutObjectCommand({
    Bucket: CONFIG_BUCKET_NAME,
    Key: configKey,
    Body: JSON.stringify(sanitizedConfig, null, 2),
    ContentType: 'application/json',
  }));
  console.log(`✓ Stored config file: ${configKey}`);
}
