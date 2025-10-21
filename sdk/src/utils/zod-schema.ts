import { z } from 'zod';
import { TableField, TableConfig } from '../types';

/**
 * Utility functions for converting Zod schemas to backend-compatible table configurations
 */

/**
 * Convert a Zod schema to RDB TableField array
 * @param schema The Zod schema to convert
 * @returns Array of TableField definitions
 */
export function zodSchemaToFields(schema: z.ZodTypeAny): TableField[] {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error('Schema must be a ZodObject');
  }

  const shape = schema.shape;
  const fields: TableField[] = [];

  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const field = zodFieldToTableField(fieldName, fieldSchema as z.ZodTypeAny);
    if (field) {
      fields.push(field);
    }
  }

  return fields;
}

/**
 * Convert a single Zod field to a TableField
 */
function zodFieldToTableField(name: string, schema: z.ZodTypeAny): TableField | null {
  // Handle optional fields
  let isOptional = false;
  let unwrapped = schema;

  if (schema instanceof z.ZodOptional) {
    isOptional = true;
    unwrapped = (schema as any)._def.innerType;
  }

  // Handle default fields
  if (schema instanceof z.ZodDefault) {
    unwrapped = (schema as any)._def.innerType;
  }

  // Skip auto-generated fields
  if (['id', 'createdAt', 'updatedAt'].includes(name)) {
    return null;
  }

  // Determine the backend type (capitalized for TableField interface)
  let backendType: 'String' | 'Int' | 'Float' | 'Boolean' | 'Array';
  let indexed = false;
  let primary = false;

  if (unwrapped instanceof z.ZodString) {
    backendType = 'String';
    // Consider email, url, and other string types as indexed
    if (name.includes('email') || name.includes('url') || name.includes('id')) {
      indexed = true;
    }
    if (name === 'id') {
      primary = true;
    }
  } else if (unwrapped instanceof z.ZodNumber) {
    // Check if it's an integer or float
    const checks = (unwrapped as any)._def.checks || [];
    const hasIntCheck = checks.some((check: any) => check.kind === 'int');
    backendType = hasIntCheck ? 'Int' : 'Float';
    
    // Index numeric fields that might be used for filtering
    if (name.includes('price') || name.includes('age') || name.includes('count')) {
      indexed = true;
    }
  } else if (unwrapped instanceof z.ZodBoolean) {
    backendType = 'Boolean';
  } else if (unwrapped instanceof z.ZodArray) {
    backendType = 'Array';
  } else if (unwrapped instanceof z.ZodDate) {
    // Dates are stored as strings in the backend
    backendType = 'String';
    indexed = true;
  } else if (unwrapped instanceof z.ZodEnum) {
    // Enums are stored as strings
    backendType = 'String';
    indexed = true; // Enums are good for filtering
  } else {
    // Default to string for unknown types
    backendType = 'String';
  }

  return {
    name,
    type: backendType,
    required: !isOptional,
    indexed,
    primary
  };
}

/**
 * Create a complete table configuration from a Zod schema
 */
export function createTableConfigFromSchema<T extends z.ZodRawShape>(
  tableName: string,
  schema: z.ZodObject<T>,
  options: {
    description?: string;
    subscriptions?: Array<{ 
      event: 'create' | 'update' | 'delete' | 'change'; 
      filters?: Array<{ field: string; type: string; operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains'; value?: any }> 
    }>;
  } = {}
): TableConfig {
  const fields = zodSchemaToFields(schema);
  
  const tableConfig: TableConfig = {
    tableName,
    fields,
    description: options.description || `Table created from Zod schema`
  };

  // Add subscriptions if provided
  if (options.subscriptions && options.subscriptions.length > 0) {
    tableConfig.subscriptions = options.subscriptions;
  }

  return tableConfig;
}/**
 * Type utility to infer the TypeScript type from a Zod schema
 * This automatically adds the standard database fields
 */
export type InferSchemaType<T extends z.ZodTypeAny> = z.infer<T> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Helper function to create a typed table with Zod schema validation
 */
export function createTypedTable<T extends z.ZodRawShape>(
  tableName: string,
  schema: z.ZodObject<T>
) {
  return {
    tableName,
    schema,
    // Type helper for TypeScript inference
    __type: {} as InferSchemaType<z.ZodObject<T>>
  };
}

// Common field validators for convenience
export const CommonFields = {
  id: z.string().optional(),
  email: z.string().email(),
  url: z.string().url(),
  phone: z.string().min(10),
  age: z.number().int().min(0).max(150),
  price: z.number().min(0),
  isActive: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  
  // Common enum fields
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  status: z.enum(['active', 'inactive', 'pending']).default('active'),
  
  // Date handling
  date: z.date().transform(date => date.toISOString()),
  timestamp: z.string().datetime(),
} as const;

/**
 * Validation helper to ensure data matches the schema before sending to backend
 */
export function validateDataWithSchema<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): z.infer<T> {
  return schema.parse(data);
}

/**
 * Partial validation for updates (all fields optional)
 */
export function validatePartialDataWithSchema<T extends z.ZodObject<any>>(
  schema: T,
  data: unknown
): Partial<z.infer<T>> {
  const partialSchema = schema.partial();
  return partialSchema.parse(data) as Partial<z.infer<T>>;
}

/**
 * Convert backend table fields to a Zod schema
 * This allows automatic schema inference from existing tables
 */
export function tableFieldsToZodSchema(fields: TableField[]): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};
  
  for (const field of fields) {
    // Skip auto-generated fields
    if (['id', 'createdAt', 'updatedAt'].includes(field.name)) {
      continue;
    }
    
    let zodType: z.ZodTypeAny;
    
    // Convert backend type to Zod type
    switch (field.type) {
      case 'String':
        zodType = z.string();
        // Add specific validations based on field name patterns
        if (field.name.includes('email')) {
          zodType = z.string().email();
        } else if (field.name.includes('url')) {
          zodType = z.string().url();
        } else if (field.name.includes('phone')) {
          zodType = z.string().min(10);
        }
        break;
        
      case 'Int':
        zodType = z.number().int();
        // Add specific validations for common numeric fields
        if (field.name.includes('age')) {
          zodType = z.number().int().min(0).max(150);
        } else if (field.name.includes('count') || field.name.includes('quantity')) {
          zodType = z.number().int().min(0);
        }
        break;
        
      case 'Float':
        zodType = z.number();
        // Add specific validations for common float fields
        if (field.name.includes('price') || field.name.includes('amount')) {
          zodType = z.number().min(0);
        }
        break;
        
      case 'Boolean':
        zodType = z.boolean();
        break;
        
      case 'Array':
        zodType = z.array(z.unknown()); // We can't infer the array element type
        break;
        
      default:
        zodType = z.string(); // Default fallback
    }
    
    // Make field optional if not required
    if (!field.required) {
      zodType = zodType.optional();
    }
    
    shape[field.name] = zodType;
  }
  
  return z.object(shape);
}

/**
 * Infer schema from table metadata response
 * This function can be used to automatically create schemas from existing tables
 */
export function inferSchemaFromTableMetadata(tableMetadata: {
  tableName: string;
  fields: TableField[];
  description?: string;
}): {
  schema: z.ZodObject<any>;
  tableName: string;
  description?: string;
} {
  const schema = tableFieldsToZodSchema(tableMetadata.fields);
  
  return {
    schema,
    tableName: tableMetadata.tableName,
    description: tableMetadata.description
  };
}