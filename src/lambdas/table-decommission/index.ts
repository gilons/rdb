import { SQSEvent, Context } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { 
  AppSyncClient, 
  DeleteResolverCommand,
  DeleteDataSourceCommand
} from '@aws-sdk/client-appsync';
import { 
  TableDecommissionMessage
} from '../../types';
import { generateAndStoreSchema } from '../../utils/schema-utils';
import { capitalize } from '../../utils';
import { deleteTableMetadata, deleteUserDataTable } from '../../utils/dynamodb';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const appSync = new AppSyncClient({ region: process.env.AWS_REGION || 'us-east-1' });

const TABLES_TABLE_NAME = process.env.TABLES_TABLE_NAME!;
const APPSYNC_API_ID = process.env.APPSYNC_API_ID!;

/**
 * Lambda handler for table decommissioning
 * Handles the complete deletion workflow asynchronously:
 * 1. Delete AppSync resolvers
 * 2. Delete AppSync data source
 * 3. Delete DynamoDB table
 * 4. Delete table metadata from rdb-tables
 * 5. Regenerate AppSync schema
 */
export const handler = async (event: SQSEvent, context: Context): Promise<void> => {
  console.log('Table decommission event received:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      const message: TableDecommissionMessage = JSON.parse(record.body);
      console.log('Processing table decommission:', message);

      await decommissionTable(message);

      console.log(`Successfully decommissioned table: ${message.tableName}`);
    } catch (error) {
      console.error('Failed to decommission table:', error);
      // Let SQS retry by throwing the error
      throw error;
    }
  }
};

/**
 * Decommission a table completely
 */
async function decommissionTable(message: TableDecommissionMessage): Promise<void> {
  const { apiKey, tableName, tableId } = message;

  console.log(`Step 1: Deleting AppSync resolvers for table: ${tableName}`);
  await deleteResolversForTable(tableName, apiKey);

  console.log(`Step 2: Deleting AppSync data source for table: ${tableName}`);
  await deleteDataSource(tableName, apiKey);

  console.log(`Step 3: Deleting DynamoDB table: rdb-data-${tableId}`);
  await deleteUserDataTable(tableId);

  console.log(`Step 4: Deleting table metadata from rdb-tables`);
  await deleteTableMetadata(apiKey, tableName);

  console.log(`Step 5: Regenerating AppSync schema`);
  await generateAndStoreSchema(apiKey);

  console.log(`Table decommissioning complete: ${tableName}`);
}

/**
 * Delete all resolvers for a specific table
 */
async function deleteResolversForTable(tableName: string, apiKey: string): Promise<void> {
  const prefixedTableName = `T${apiKey}_${tableName}`;
  const typeName = capitalize(prefixedTableName);

  // List of all resolvers to delete
  const resolvers = [
    { typeName: 'Query', fieldName: `get${typeName}` },
    { typeName: 'Query', fieldName: `list${typeName}` },
    { typeName: 'Mutation', fieldName: `create${typeName}` },
    { typeName: 'Mutation', fieldName: `update${typeName}` },
    { typeName: 'Mutation', fieldName: `delete${typeName}` },
  ];

  for (const resolver of resolvers) {
    try {
      await appSync.send(new DeleteResolverCommand({
        apiId: APPSYNC_API_ID,
        typeName: resolver.typeName,
        fieldName: resolver.fieldName,
      }));
      console.log(`  ✓ Deleted resolver: ${resolver.typeName}.${resolver.fieldName}`);
    } catch (error: any) {
      if (error.name === 'NotFoundException') {
        console.log(`  - Resolver ${resolver.typeName}.${resolver.fieldName} not found, skipping`);
      } else {
        console.warn(`  ✗ Failed to delete resolver ${resolver.typeName}.${resolver.fieldName}:`, error.message);
      }
    }
  }
}

/**
 * Delete AppSync data source for a table
 */
async function deleteDataSource(tableName: string, apiKey: string): Promise<void> {
  const dataSourceName = `rdb_data_${apiKey}_${tableName}`;

  try {
    await appSync.send(new DeleteDataSourceCommand({
      apiId: APPSYNC_API_ID,
      name: dataSourceName,
    }));
    console.log(`  ✓ Deleted data source: ${dataSourceName}`);
  } catch (error: any) {
    if (error.name === 'NotFoundException') {
      console.log(`  - Data source ${dataSourceName} not found, skipping`);
    } else {
      console.warn(`  ✗ Failed to delete data source ${dataSourceName}:`, error.message);
    }
  }
}
