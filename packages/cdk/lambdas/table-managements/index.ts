import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { 
  TableField, 
  TableConfig, 
  TableItem
} from '../../types';
import { generateAndStoreSchema } from '../../utils/schema-utils';
import { getAttributeType } from '../../utils';
import { 
  queryTablesByApiKey,
  getTable,
  putTable,
  updateTable as updateTableMetadata,
  createUserDataTable,
  deleteUserDataTable
} from '../../utils/dynamodb';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });

const TABLES_TABLE_NAME = process.env.TABLES_TABLE_NAME!;
const CONFIG_BUCKET_NAME = process.env.CONFIG_BUCKET_NAME!;
const APPSYNC_API_ID = process.env.APPSYNC_API_ID!;
const DECOMMISSION_QUEUE_URL = process.env.DECOMMISSION_QUEUE_URL!;

type Variables = {
  apiKey: string;
  apiKeyHash: string;
};

const app = new Hono<{ Variables: Variables }>();

// Enable CORS
app.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Amz-Date, Authorization, X-Api-Key');
});

// Middleware to extract API key
app.use('*', async (c, next) => {
  const apiKey = c.req.header('X-Api-Key') || c.req.raw.headers.get('x-api-key');
  if (apiKey) {
    c.set('apiKey', apiKey);
    c.set('apiKeyHash', getApiKeyHash(apiKey));
  }
  await next();
});

/**
 * GET /tables
 * List all tables for the authenticated API key
 */
app.get('/tables', async (c) => {
  const apiKeyHash = c.get('apiKeyHash') as string;
  
  try {
    const result = await queryTablesByApiKey(apiKeyHash);

    return c.json({
      tables: result.Items || [],
      count: result.Count,
    });
  } catch (error) {
    console.error('Error listing tables:', error);
    return c.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * GET /tables/:tableName
 * Get details for a specific table
 */
app.get('/tables/:tableName', async (c) => {
  const apiKeyHash = c.get('apiKeyHash') as string;
  const tableName = c.req.param('tableName');

  try {
    const result = await getTable(apiKeyHash, tableName);
    
    if (!result.Item) {
      return c.json({ error: 'Table not found' }, 404);
    }

    return c.json(result.Item);
  } catch (error) {
    console.error('Error getting table details:', error);
    return c.json({ error: 'Failed to get table details' }, 500);
  }
});

/**
 * GET /tables/:tableName/schema
 * Get schema for a specific table
 */
app.get('/tables/:tableName/schema', async (c) => {
  const apiKeyHash = c.get('apiKeyHash') as string;
  const tableName = c.req.param('tableName');

  try {
    const result = await getTable(apiKeyHash, tableName);
    
    if (!result.Item) {
      return c.json({ error: 'Table not found' }, 404);
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

    return c.json({ fields });
  } catch (error) {
    console.error('Error getting table schema:', error);
    return c.json({ error: 'Failed to get table schema' }, 500);
  }
});

/**
 * POST /tables
 * Create a new table
 */
app.post('/tables', async (c) => {
  const apiKeyHash = c.get('apiKeyHash') as string;

  try {
    const tableConfig = await c.req.json<TableConfig>();
    const { tableName, fields, subscriptions, description } = tableConfig;

    if (!tableName || !fields) {
      return c.json({ error: 'tableName and fields are required' }, 400);
    }

    // Validate field definitions
    if (!Array.isArray(fields) || fields.length === 0) {
      return c.json({ error: 'fields must be a non-empty array' }, 400);
    }

    const tableId = uuidv4();
    const timestamp = new Date().toISOString();
    
    // Generate GraphQL type name with prefix
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

    try {
      // Save table metadata to DynamoDB
      await putTable(tableItem, 'attribute_not_exists(tableName)');

      // Create DynamoDB table for the actual data
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

      // Create Global Secondary Indexes for indexed fields (enables efficient Query operations)
      const indexedFields = fields.filter(f => f.indexed && !f.primary);
      const globalSecondaryIndexes = indexedFields.map(field => {
        // Add attribute definition for the indexed field
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
            ProjectionType: 'ALL' as const, // Project all attributes for flexibility
          },
        };
      });
      
      await createUserDataTable(tableId, keySchema, attributeDefinitions, globalSecondaryIndexes.length > 0 ? globalSecondaryIndexes : undefined);

      // Generate and store AppSync schema configuration
      await generateAndStoreSchema(apiKeyHash);

      return c.json({
        message: 'Table created successfully',
        table: tableItem,
      }, 201);
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        return c.json({ error: 'Table already exists' }, 409);
      }
      throw error;
    }
  } catch (error) {
    console.error('Error creating table:', error);
    return c.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * PUT /tables/:tableName
 * Update an existing table
 */
app.put('/tables/:tableName', async (c) => {
  const apiKeyHash = c.get('apiKeyHash') as string;
  const tableName = c.req.param('tableName');

  try {
    const updates = await c.req.json<Partial<TableConfig>>();
    const timestamp = new Date().toISOString();
    
    // Regenerate GraphQL type name to ensure consistency
    const graphqlTypeName = `T${apiKeyHash}_${tableName}`;
    
    let updateExpression = 'SET updatedAt = :updatedAt, graphqlTypeName = :graphqlTypeName';
    const expressionAttributeValues: any = {
      ':updatedAt': timestamp,
      ':graphqlTypeName': graphqlTypeName,
    };
    const expressionAttributeNames: any = {};

    if (updates.fields) {
      updateExpression += ', #fields = :fields';
      expressionAttributeNames['#fields'] = 'fields'; // 'fields' is a reserved keyword
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
      updateExpression += ', #description = :description';
      expressionAttributeNames['#description'] = 'description'; // 'description' is also a reserved keyword
      expressionAttributeValues[':description'] = updates.description;
    }

    try {
      await updateTableMetadata(
        apiKeyHash, 
        tableName, 
        updateExpression, 
        expressionAttributeValues,
        Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined
      );

      // Regenerate AppSync schema
      await generateAndStoreSchema(apiKeyHash);

      return c.json({ message: 'Table updated successfully' });
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        return c.json({ error: 'Table not found' }, 404);
      }
      throw error;
    }
  } catch (error) {
    console.error('Error updating table:', error);
    return c.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * DELETE /tables/:tableName
 * Delete a table (asynchronous)
 */
app.delete('/tables/:tableName', async (c) => {
  const apiKeyHash = c.get('apiKeyHash') as string;
  const tableName = c.req.param('tableName');

  try {
    // Get table info first
    const tableResult = await getTable(apiKeyHash, tableName);

    if (!tableResult.Item) {
      return c.json({ error: 'Table not found' }, 404);
    }

    const { tableId } = tableResult.Item as TableItem;

    // Send message to decommission queue for async processing
    const decommissionMessage = {
      apiKey: apiKeyHash,
      tableName,
      tableId,
    };

    await sqs.send(new SendMessageCommand({
      QueueUrl: DECOMMISSION_QUEUE_URL,
      MessageBody: JSON.stringify(decommissionMessage),
    }));

    console.log(`Table decommission initiated for: ${tableName}`);

    return c.json({ 
      message: 'Table deletion initiated. The table will be decommissioned asynchronously.',
      tableName,
      status: 'pending'
    }, 202);
  } catch (error) {
    console.error('Error deleting table:', error);
    return c.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * POST /tables/batch
 * Create multiple tables in a single request
 * This triggers schema generation only once after all tables are created
 */
app.post('/tables/batch', async (c) => {
  const apiKeyHash = c.get('apiKeyHash') as string;

  try {
    const { tables } = await c.req.json<{ tables: TableConfig[] }>();

    if (!tables || !Array.isArray(tables) || tables.length === 0) {
      return c.json({ error: 'tables array is required and cannot be empty' }, 400);
    }

    // Validate all table configurations first
    for (const tableConfig of tables) {
      const { tableName, fields } = tableConfig;
      
      if (!tableName || !fields) {
        return c.json({ error: `tableName and fields are required for each table. Invalid table: ${tableName || 'unnamed'}` }, 400);
      }

      if (!Array.isArray(fields) || fields.length === 0) {
        return c.json({ error: `fields must be a non-empty array for table: ${tableName}` }, 400);
      }
    }

    const createdTables: TableItem[] = [];
    const errors: { tableName: string; error: string }[] = [];
    const timestamp = new Date().toISOString();

    // Create all tables
    for (const tableConfig of tables) {
      const { tableName, fields, subscriptions, description } = tableConfig;

      try {
        const tableId = uuidv4();
        
        // Generate GraphQL type name with prefix
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

        // Create DynamoDB table for the actual data
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

        // Create Global Secondary Indexes for indexed fields
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
        
        await createUserDataTable(tableId, keySchema, attributeDefinitions, globalSecondaryIndexes.length > 0 ? globalSecondaryIndexes : undefined);

        createdTables.push(tableItem);
        console.log(`Created table: ${tableName}`);
      } catch (error: any) {
        if (error.name === 'ConditionalCheckFailedException') {
          errors.push({ tableName, error: 'Table already exists' });
        } else {
          errors.push({ tableName, error: error.message || 'Unknown error' });
        }
        console.error(`Failed to create table ${tableName}:`, error);
      }
    }

    // Generate schema ONCE for all created tables
    if (createdTables.length > 0) {
      console.log(`Generating schema for ${createdTables.length} tables...`);
      await generateAndStoreSchema(apiKeyHash);
    }

    return c.json({
      message: `Batch table creation completed`,
      created: createdTables.length,
      failed: errors.length,
      tables: createdTables,
      errors: errors.length > 0 ? errors : undefined,
    }, createdTables.length > 0 ? 201 : 400);
  } catch (error) {
    console.error('Error in batch table creation:', error);
    return c.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Generate a consistent hash for API key (for logging and identification)
 */
function getApiKeyHash(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 8);
}

// Export handler for Lambda
export const handler = handle(app);