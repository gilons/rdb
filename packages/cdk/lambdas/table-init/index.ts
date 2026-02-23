/**
 * Table Initialization Lambda
 * 
 * CDK Custom Resource handler for initializing RDB tables after stack deployment.
 * This allows users to define tables in their CDK code and have them created
 * automatically when the stack is deployed.
 * 
 * Usage in CDK:
 *   const rdb = new RdbConstruct(this, 'MyRdb', {
 *     initialTables: [
 *       {
 *         tableName: 'users',
 *         fields: [
 *           { name: 'id', type: 'String', primary: true },
 *           { name: 'email', type: 'String', required: true, indexed: true },
 *         ],
 *         subscriptions: [{ filters: [{ field: 'id', type: 'string' }] }],
 *       },
 *       // ... more tables
 *     ],
 *   });
 */

import { 
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
  Context 
} from 'aws-lambda';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { TableField, TableConfig, TableItem } from '../../types';
import { generateAndStoreSchema } from '../../utils/schema-utils';
import { getAttributeType } from '../../utils';
import { 
  putTable,
  createUserDataTable,
  deleteUserDataTable,
  queryTablesByApiKey,
  deleteTableMetadata
} from '../../utils/dynamodb';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const TABLES_TABLE_NAME = process.env.TABLES_TABLE_NAME!;
const CONFIG_BUCKET_NAME = process.env.CONFIG_BUCKET_NAME!;
const APPSYNC_API_ID = process.env.APPSYNC_API_ID!;

interface TableInitProps {
  tables: TableConfig[];
  apiKey: string;
}

/**
 * Generate a consistent hash for API key
 */
function getApiKeyHash(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 8);
}

/**
 * Create tables from configuration
 */
async function createTables(tables: TableConfig[], apiKeyHash: string): Promise<{
  created: string[];
  failed: { tableName: string; error: string }[];
}> {
  const created: string[] = [];
  const failed: { tableName: string; error: string }[] = [];
  const timestamp = new Date().toISOString();

  for (const tableConfig of tables) {
    const { tableName, fields, subscriptions, description } = tableConfig;

    try {
      const tableId = uuidv4();
      const graphqlTypeName = `T${apiKeyHash}_${tableName}`;
      
      const tableItem: TableItem = {
        apiKey: apiKeyHash,
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
        graphqlTypeName,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      // Save table metadata to DynamoDB
      await putTable(tableItem, 'attribute_not_exists(tableName)');

      // Create DynamoDB data table
      const primaryKeyField = fields.find(f => f.primary) || fields[0];
      
      const keySchema = [
        {
          AttributeName: primaryKeyField.name,
          KeyType: 'HASH' as const,
        },
      ];
      
      const attributeDefinitions = [
        {
          AttributeName: primaryKeyField.name,
          AttributeType: getAttributeType(primaryKeyField.type),
        },
      ];

      // Create GSIs for indexed fields
      const indexedFields = fields.filter(f => f.indexed && !f.primary);
      const globalSecondaryIndexes = indexedFields.map(field => {
        attributeDefinitions.push({
          AttributeName: field.name,
          AttributeType: getAttributeType(field.type),
        });

        return {
          IndexName: `${field.name}-index`,
          KeySchema: [
            {
              AttributeName: field.name,
              KeyType: 'HASH' as const,
            },
          ],
          Projection: {
            ProjectionType: 'ALL' as const,
          },
        };
      });
      
      await createUserDataTable(
        tableId, 
        keySchema, 
        attributeDefinitions, 
        globalSecondaryIndexes.length > 0 ? globalSecondaryIndexes : undefined
      );

      created.push(tableName);
      console.log(`✓ Created table: ${tableName}`);
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Table already exists, consider it successful
        console.log(`Table already exists (skipping): ${tableName}`);
        created.push(tableName);
      } else if (error.name === 'ResourceInUseException') {
        // DynamoDB table already exists
        console.log(`DynamoDB table already exists (skipping): ${tableName}`);
        created.push(tableName);
      } else {
        failed.push({ tableName, error: error.message || 'Unknown error' });
        console.error(`✗ Failed to create table ${tableName}:`, error);
      }
    }
  }

  return { created, failed };
}

/**
 * Delete tables (for stack deletion)
 */
async function deleteTables(apiKeyHash: string): Promise<void> {
  console.log(`Deleting all tables for API key hash: ${apiKeyHash}`);
  
  try {
    // Query all tables for this API key
    const result = await queryTablesByApiKey(apiKeyHash);
    const tables = result.Items || [];
    
    for (const table of tables) {
      const { tableName, tableId } = table as TableItem;
      
      try {
        // Delete DynamoDB data table
        await deleteUserDataTable(tableId);
        console.log(`✓ Deleted data table: rdb-data-${tableId}`);
      } catch (error: any) {
        console.warn(`Failed to delete data table for ${tableName}:`, error.message);
      }
      
      try {
        // Delete metadata
        await deleteTableMetadata(apiKeyHash, tableName);
        console.log(`✓ Deleted metadata for: ${tableName}`);
      } catch (error: any) {
        console.warn(`Failed to delete metadata for ${tableName}:`, error.message);
      }
    }
    
    // Clean up S3 schema files
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: CONFIG_BUCKET_NAME,
        Key: `schemas/${apiKeyHash}/schema.graphql`,
      }));
      await s3.send(new DeleteObjectCommand({
        Bucket: CONFIG_BUCKET_NAME,
        Key: `schemas/${apiKeyHash}/config.json`,
      }));
      console.log(`✓ Deleted schema files for API key`);
    } catch (error: any) {
      console.warn(`Failed to delete schema files:`, error.message);
    }
  } catch (error) {
    console.error('Error during table cleanup:', error);
  }
}

/**
 * CloudFormation Custom Resource handler
 */
export const handler = async (
  event: CloudFormationCustomResourceEvent,
  context: Context
): Promise<CloudFormationCustomResourceResponse> => {
  console.log('Table init event:', JSON.stringify(event, null, 2));
  
  const { RequestType, ResourceProperties } = event;
  const props = ResourceProperties as unknown as TableInitProps & { ServiceToken: string };
  
  const apiKeyHash = getApiKeyHash(props.apiKey);
  // PhysicalResourceId only exists for Update/Delete events
  const existingPhysicalId = 'PhysicalResourceId' in event ? event.PhysicalResourceId : undefined;
  const physicalResourceId = existingPhysicalId || `rdb-tables-${apiKeyHash}`;
  
  let status: 'SUCCESS' | 'FAILED' = 'SUCCESS';
  let reason = '';
  let data: Record<string, any> = {};

  try {
    switch (RequestType) {
      case 'Create':
      case 'Update': {
        console.log(`Processing ${RequestType} for ${props.tables.length} tables`);
        
        // Create/update tables
        const { created, failed } = await createTables(props.tables, apiKeyHash);
        
        // Generate schema once for all tables
        if (created.length > 0) {
          console.log('Generating unified schema...');
          await generateAndStoreSchema(apiKeyHash);
        }
        
        data = {
          apiKeyHash,
          tablesCreated: created.length,
          tablesFailed: failed.length,
          tables: created,
          errors: failed.length > 0 ? failed : undefined,
        };
        
        if (failed.length > 0 && created.length === 0) {
          status = 'FAILED';
          reason = `All tables failed to create: ${failed.map(f => `${f.tableName}: ${f.error}`).join(', ')}`;
        }
        
        console.log(`${RequestType} completed: ${created.length} tables created, ${failed.length} failed`);
        break;
      }
      
      case 'Delete': {
        console.log('Processing Delete - cleaning up tables');
        await deleteTables(apiKeyHash);
        data = { message: 'Tables cleaned up successfully' };
        break;
      }
    }
  } catch (error: any) {
    console.error('Error in table init handler:', error);
    status = 'FAILED';
    reason = error.message || 'Unknown error';
  }

  // Return CloudFormation response
  const response: CloudFormationCustomResourceResponse = {
    Status: status,
    Reason: reason || `${RequestType} completed successfully`,
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data,
  };

  console.log('Response:', JSON.stringify(response, null, 2));
  return response;
};
