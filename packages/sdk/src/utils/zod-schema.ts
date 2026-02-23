import { z } from 'zod';
import { TableField, TableConfig } from '../types';

/**
 * Utility functions for converting Zod schemas to backend-compatible table configurations
 */

/**
 * Check if a value is a ZodObject using duck-typing
 * This works across different Zod instances/versions
 */
function isZodObject(schema: any): schema is z.ZodObject<any> {
  return (
    schema &&
    typeof schema === 'object' &&
    typeof schema.shape === 'object' &&
    typeof schema.parse === 'function' &&
    (schema._def?.typeName === 'ZodObject' || schema.constructor?.name === 'ZodObject')
  );
}

/**
 * Convert a Zod schema to RDB TableField array
 * @param schema The Zod schema to convert
 * @returns Array of TableField definitions
 */
export function zodSchemaToFields(schema: z.ZodTypeAny): TableField[] {
  if (!isZodObject(schema)) {
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
 * Get the Zod type name using duck-typing (works across Zod versions)
 */
function getZodTypeName(schema: any): string | undefined {
  return schema?._def?.typeName || schema?.constructor?.name;
}

/**
 * Convert a single Zod field to a TableField
 */
function zodFieldToTableField(name: string, schema: z.ZodTypeAny): TableField | null {
  // Handle optional fields
  let isOptional = false;
  let unwrapped = schema;
  const typeName = getZodTypeName(schema);

  if (typeName === 'ZodOptional') {
    isOptional = true;
    unwrapped = (schema as any)._def.innerType;
  }

  // Handle default fields
  if (getZodTypeName(unwrapped) === 'ZodDefault') {
    unwrapped = (unwrapped as any)._def.innerType;
  }

  // Determine the backend type (capitalized for TableField interface)
  let backendType: 'String' | 'Int' | 'Float' | 'Boolean' | 'Array';
  let indexed = false;
  let primary = false;
  const unwrappedTypeName = getZodTypeName(unwrapped);

  if (unwrappedTypeName === 'ZodString') {
    backendType = 'String';
  } else if (unwrappedTypeName === 'ZodNumber') {
    // Check if it's an integer or float
    const checks = (unwrapped as any)._def.checks || [];
    const hasIntCheck = checks.some((check: any) => check.kind === 'int');
    backendType = hasIntCheck ? 'Int' : 'Float';
  } else if (unwrappedTypeName === 'ZodBoolean') {
    backendType = 'Boolean';
  } else if (unwrappedTypeName === 'ZodArray') {
    backendType = 'Array';
  } else if (unwrappedTypeName === 'ZodDate') {
    // Dates are stored as strings in the backend
    backendType = 'String';
  } else if (unwrappedTypeName === 'ZodEnum') {
    // Enums are stored as strings
    backendType = 'String';
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
    indexedFields?: string[]; // Array of field names to create GSIs for
    subscriptions?: Array<{ 
      // Filters that will be added as parameters to ALL subscription queries (onCreate, onUpdate, onDelete)
      filters?: Array<{ field: string; type: string; operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains'; value?: any }> 
    }>;
  } = {}
): TableConfig {
  const fields = zodSchemaToFields(schema);
  
  // Mark fields as indexed if specified in indexedFields option
  if (options.indexedFields && options.indexedFields.length > 0) {
    options.indexedFields.forEach(fieldName => {
      const field = fields.find(f => f.name === fieldName);
      if (field) {
        field.indexed = true;
        console.log(`[RDB] Field '${fieldName}' will be indexed for GSI`);
      } else {
        console.warn(`[RDB] Warning: Indexed field '${fieldName}' not found in schema fields`);
      }
    });
  }
  
  // Ensure 'id' field exists and is marked as primary key
  const idFieldIndex = fields.findIndex(f => f.name === 'id');
  if (idFieldIndex !== -1 && fields[idFieldIndex]) {
    // 'id' field exists in user schema - mark it as primary and ensure it's a String
    const existingField = fields[idFieldIndex];
    fields[idFieldIndex] = {
      name: existingField.name,
      type: 'String',
      required: existingField.required ?? true, // Default to true if undefined
      primary: true,
      indexed: false // Primary keys don't need GSI
    };
  } else {
    // 'id' field doesn't exist - add it as the first field
    fields.unshift({
      name: 'id',
      type: 'String',
      required: true,
      primary: true,
      indexed: false
    });
  }
  
  // Add system timestamp fields if they don't already exist
  const systemFields: TableField[] = [];
  
  if (!fields.find(f => f.name === 'createdAt')) {
    systemFields.push({
      name: 'createdAt',
      type: 'String',
      required: true,
      indexed: false,
      primary: false
    });
  }
  
  if (!fields.find(f => f.name === 'updatedAt')) {
    systemFields.push({
      name: 'updatedAt',
      type: 'String',
      required: true,
      indexed: false,
      primary: false
    });
  }
  
  // Add system timestamp fields after the user fields (id is already first)
  const allFields = [...fields, ...systemFields];
  
  const tableConfig: TableConfig = {
    tableName,
    fields: allFields,
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
  
  const result: {
    schema: z.ZodObject<any>;
    tableName: string;
    description?: string;
  } = {
    schema,
    tableName: tableMetadata.tableName,
  };
  
  if (tableMetadata.description) {
    result.description = tableMetadata.description;
  }
  
  return result;
}