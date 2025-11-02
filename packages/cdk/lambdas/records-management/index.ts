import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import * as https from 'https';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getTable } from '../../utils/dynamodb';
import { getGraphQLType, capitalize } from '../../utils';

const APPSYNC_API_URL = process.env.APPSYNC_API_URL!;
const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY!;
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
  graphqlTypeName?: string;
}

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
  const apiKey = c.req.header('X-Api-Key') || c.req.header('x-api-key');
  if (apiKey) {
    c.set('apiKey', apiKey);
    c.set('apiKeyHash', getApiKeyHash(apiKey));
  }
  await next();
});

/**
 * GET /tables/:tableName/records
 * List all records in a table
 */
app.get('/tables/:tableName/records', async (c) => {
  const apiKeyHash = c.get('apiKeyHash');
  const tableName = c.req.param('tableName');
  const limit = parseInt(c.req.query('limit') || '50');
  const nextToken = c.req.query('nextToken');

  try {
    // Verify table exists and get table info
    const tableInfo = await getTableInfo(apiKeyHash, tableName);
    if (!tableInfo) {
      return c.json({ success: false, error: 'Table not found' }, 404);
    }

    // Extract filter parameters from query (format: filter_fieldName=value)
    const filters: Record<string, any> = {};
    const queryParams = c.req.query();
    Object.keys(queryParams).forEach(key => {
      if (key.startsWith('filter_')) {
        const fieldName = key.substring(7); // Remove 'filter_' prefix
        filters[fieldName] = queryParams[key];
      }
    });

    // Build GraphQL query
    const graphqlTypeName = tableInfo.graphqlTypeName || `T${tableInfo.apiKey}_${tableInfo.tableName}`;
    const capitalizedTypeName = capitalize(graphqlTypeName);
    
    // Build field list from table schema
    const fieldsList = tableInfo.fields.map(f => f.name).join('\n    ');
    
    // Build filter parameters for GraphQL query (only indexed fields for efficiency)
    const indexedFields = tableInfo.fields.filter(f => f.indexed && !f.primary);
    const filterVariableDeclarations: string[] = [];
    const filterArguments: string[] = [];
    const filterVariables: Record<string, any> = {};
    
    indexedFields.forEach(field => {
      if (filters[field.name] !== undefined) {
        const graphqlType = getGraphQLType(field.type);
        filterVariableDeclarations.push(`$${field.name}: ${graphqlType}`);
        filterArguments.push(`${field.name}: $${field.name}`);
        filterVariables[field.name] = filters[field.name];
      }
    });
    
    const filterVarDecl = filterVariableDeclarations.length > 0 
      ? ', ' + filterVariableDeclarations.join(', ')
      : '';
    const filterArgs = filterArguments.length > 0
      ? filterArguments.join(', ') + ', '
      : '';
    
    const query = `
      query List${capitalizedTypeName}($limit: Int, $nextToken: String${filterVarDecl}) {
        list${capitalizedTypeName}(${filterArgs}limit: $limit, nextToken: $nextToken) {
          items {
            ${fieldsList}
          }
          nextToken
        }
      }
    `;

    const variables = {
      limit: Math.min(limit, 100),
      ...(nextToken && { nextToken }),
      ...filterVariables,
    };

    const result = await executeGraphQL(query, variables);
    
    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return c.json({ 
        success: false,
        error: 'GraphQL query failed',
        details: result.errors 
      }, 400);
    }

    const data = result.data[`list${capitalizedTypeName}`];
    
    return c.json({
      success: true,
      data: {
        items: data.items || [],
        count: data.items?.length || 0,
        nextToken: data.nextToken || null,
      }
    });
  } catch (error) {
    console.error('Error listing records:', error);
    return c.json({ 
      success: false,
      error: 'Failed to list records',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /tables/:tableName/records/:recordId
 * Get a single record by its ID (primary key)
 */
app.get('/tables/:tableName/records/:recordId', async (c) => {
  const apiKeyHash = c.get('apiKeyHash');
  const tableName = c.req.param('tableName');
  const recordId = c.req.param('recordId');

  try {
    // Verify table exists and get table info
    const tableInfo = await getTableInfo(apiKeyHash, tableName);
    if (!tableInfo) {
      return c.json({ success: false, error: 'Table not found' }, 404);
    }

    const { fields } = tableInfo;
    
    // Get primary key field (should be 'id' for most tables)
    const primaryKey = fields.find(f => f.primary) || fields[0];

    if (!primaryKey) {
      return c.json({ error: 'No primary key found in table definition' }, 500);
    }

    // Build GraphQL query
    const graphqlTypeName = tableInfo.graphqlTypeName || `T${tableInfo.apiKey}_${tableInfo.tableName}`;
    const capitalizedTypeName = capitalize(graphqlTypeName);
    
    // Build field list from table schema
    const fieldsList = fields.map(f => f.name).join('\n      ');
    
    // Map field type for GraphQL
    const pkGraphQLType = getGraphQLType(primaryKey.type);
    
    const query = `
      query Get${capitalizedTypeName}($${primaryKey.name}: ${pkGraphQLType}!) {
        get${capitalizedTypeName}(${primaryKey.name}: $${primaryKey.name}) {
          ${fieldsList}
        }
      }
    `;

    const variables = {
      [primaryKey.name]: recordId,
    };

    const result = await executeGraphQL(query, variables);
    
    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return c.json({ 
        success: false,
        error: 'GraphQL query failed',
        details: result.errors 
      }, 400);
    }

    const record = result.data[`get${capitalizedTypeName}`];

    console.warn('response:', result);

    console.warn('query:', query);
    
    // Return null if record not found (GraphQL returns null for non-existent records)
    if (!record) {
      return c.json({
        success: true,
        data: null,
        message: 'Record not found'
      }, 404);
    }
    
    return c.json({
      success: true,
      data: record,
    });
  } catch (error) {
    console.error('Error getting record:', error);
    return c.json({ 
      success: false,
      error: 'Failed to get record',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * POST /tables/:tableName/records
 * Create a new record in a table
 */
app.post('/tables/:tableName/records', async (c) => {
  const apiKeyHash = c.get('apiKeyHash');
  const tableName = c.req.param('tableName');

  try {
    const recordData = await c.req.json<TableRecord>();

    // Verify table exists and get table info
    const tableInfo = await getTableInfo(apiKeyHash, tableName);
    if (!tableInfo) {
      return c.json({ success: false, error: 'Table not found' }, 404);
    }

    const { fields } = tableInfo;

    // Auto-generate 'id' if not provided (id is always the primary key)
    if (!recordData.id) {
      recordData.id = uuidv4();
    }

    // Auto-set timestamps (ISO 8601 format)
    const now = new Date().toISOString();
    recordData.createdAt = now;
    recordData.updatedAt = now;

    // Validate required fields (skip system-managed fields: id, createdAt, updatedAt)
    const requiredFields = fields.filter(field => 
      field.required && 
      field.name !== 'id' && 
      field.name !== 'createdAt' && 
      field.name !== 'updatedAt'
    );
    for (const field of requiredFields) {
      if (recordData[field.name] === undefined || recordData[field.name] === null || recordData[field.name] === '') {
        return c.json({ error: `Required field '${field.name}' is missing` }, 400);
      }
    }

    // Validate field types
    for (const field of fields) {
      const value = recordData[field.name];
      if (value !== undefined && !validateFieldType(value, field.type)) {
        return c.json({ 
          error: `Invalid type for field '${field.name}'. Expected ${field.type}` 
        }, 400);
      }
    }

    // Build GraphQL mutation
    const graphqlTypeName = tableInfo.graphqlTypeName || `T${tableInfo.apiKey}_${tableInfo.tableName}`;
    const capitalizedTypeName = capitalize(graphqlTypeName);
    
    // Build field list from table schema
    const fieldsList = fields.map(f => f.name).join('\n      ');
    
    const mutation = `
      mutation Create${capitalizedTypeName}($input: ${capitalizedTypeName}Input!) {
        create${capitalizedTypeName}(input: $input) {
          ${fieldsList}
        }
      }
    `;

    const variables = {
      input: recordData,
    };

    const result = await executeGraphQL(mutation, variables);
    
    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return c.json({ 
        success: false,
        error: 'GraphQL mutation failed',
        details: result.errors 
      }, 400);
    }

    const createdRecord = result.data[`create${capitalizedTypeName}`];
    
    return c.json({
      success: true,
      message: 'Record created successfully',
      data: createdRecord,
    }, 201);
  } catch (error) {
    console.error('Error creating record:', error);
    return c.json({ 
      success: false,
      error: 'Failed to create record',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * PUT /tables/:tableName/records/:recordId
 * Update an existing record in a table
 */
app.put('/tables/:tableName/records/:recordId', async (c) => {
  const apiKeyHash = c.get('apiKeyHash');
  const tableName = c.req.param('tableName');
  const recordId = c.req.param('recordId');

  try {
    const updates = await c.req.json<TableRecord>();

    // Verify table exists and get table info
    const tableInfo = await getTableInfo(apiKeyHash, tableName);
    if (!tableInfo) {
      return c.json({ success: false, error: 'Table not found' }, 404);
    }

    const { fields } = tableInfo;
    const primaryKey = fields.find(f => f.primary) || fields[0];

    if (!primaryKey) {
      return c.json({ error: 'No primary key found in table definition' }, 500);
    }

    // Remove system-managed fields that should not be in the update input
    // These fields are either immutable (id, createdAt) or auto-managed (updatedAt)
    delete updates.createdAt;
    delete updates[primaryKey.name]; // Remove primary key from updates

    // Auto-update timestamp
    updates.updatedAt = new Date().toISOString();

    // Validate field types for provided fields
    for (const field of fields) {
      const value = updates[field.name];
      if (value !== undefined && !validateFieldType(value, field.type)) {
        return c.json({ 
          error: `Invalid type for field '${field.name}'. Expected ${field.type}` 
        }, 400);
      }
    }

    // Build GraphQL mutation
    const graphqlTypeName = tableInfo.graphqlTypeName || `T${tableInfo.apiKey}_${tableInfo.tableName}`;
    const capitalizedTypeName = capitalize(graphqlTypeName);
    
    // Build field list from table schema
    const fieldsList = fields.map(f => f.name).join('\n      ');
    
    // Map field type for GraphQL
    const pkGraphQLType = getGraphQLType(primaryKey.type);
    
    const mutation = `
      mutation Update${capitalizedTypeName}($${primaryKey.name}: ${pkGraphQLType}!, $input: ${capitalizedTypeName}UpdateInput!) {
        update${capitalizedTypeName}(${primaryKey.name}: $${primaryKey.name}, input: $input) {
          ${fieldsList}
        }
      }
    `;

    const variables = {
      [primaryKey.name]: recordId,
      input: updates,
    };

    const result = await executeGraphQL(mutation, variables);
    
    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return c.json({ 
        success: false,
        error: 'GraphQL mutation failed',
        details: result.errors 
      }, 400);
    }

    const updatedRecord = result.data[`update${capitalizedTypeName}`];
    
    if (!updatedRecord) {
      return c.json({
        success: false,
        error: 'Record not found',
        message: 'No record was updated. Record may not exist.'
      }, 404);
    }
    
    return c.json({
      success: true,
      message: 'Record updated successfully',
      data: updatedRecord,
    });
  } catch (error) {
    console.error('Error updating record:', error);
    return c.json({ 
      success: false,
      error: 'Failed to update record',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * DELETE /tables/:tableName/records/:recordId
 * Delete a record from a table
 */
app.delete('/tables/:tableName/records/:recordId', async (c) => {
  const apiKeyHash = c.get('apiKeyHash');
  const tableName = c.req.param('tableName');
  const recordId = c.req.param('recordId');

  try {
    // Verify table exists and get table info
    const tableInfo = await getTableInfo(apiKeyHash, tableName);
    if (!tableInfo) {
      return c.json({ success: false, error: 'Table not found' }, 404);
    }

    const { fields } = tableInfo;
    const primaryKey = fields.find(f => f.primary) || fields[0];

    if (!primaryKey) {
      return c.json({ error: 'No primary key found in table definition' }, 500);
    }

    // Build GraphQL mutation
    const graphqlTypeName = tableInfo.graphqlTypeName || `T${tableInfo.apiKey}_${tableInfo.tableName}`;
    const capitalizedTypeName = capitalize(graphqlTypeName);
    
    // Build field list from table schema
    const fieldsList = fields.map(f => f.name).join('\n      ');
    
    // Map field type for GraphQL
    const pkGraphQLType = getGraphQLType(primaryKey.type);
    
    const mutation = `
      mutation Delete${capitalizedTypeName}($${primaryKey.name}: ${pkGraphQLType}!) {
        delete${capitalizedTypeName}(${primaryKey.name}: $${primaryKey.name}) {
          ${fieldsList}
        }
      }
    `;

    const variables = {
      [primaryKey.name]: recordId,
    };

    const result = await executeGraphQL(mutation, variables);
    
    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return c.json({ 
        success: false,
        error: 'GraphQL mutation failed',
        details: result.errors 
      }, 400);
    }

    const deletedRecord = result.data[`delete${capitalizedTypeName}`];
    
    return c.json({ 
      success: true,
      message: 'Record deleted successfully',
      data: deletedRecord
    });
  } catch (error) {
    console.error('Error deleting record:', error);
    return c.json({ 
      success: false,
      error: 'Failed to delete record',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Get table information
 */
async function getTableInfo(apiKey: string, tableName: string): Promise<TableInfo | null> {
  const result = await getTable(apiKey, tableName);
  return result.Item as TableInfo || null;
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
 * Execute GraphQL query/mutation against AppSync
 */
async function executeGraphQL(query: string, variables: any = {}): Promise<any> {
  const url = new URL(APPSYNC_API_URL);
  
  const payload = JSON.stringify({
    query,
    variables,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': APPSYNC_API_KEY,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse GraphQL response: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Generate a consistent hash for API key (for logging and identification)
 */
function getApiKeyHash(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 8);
}

// Export handler for Lambda
export const handler = handle(app);