import * as crypto from 'crypto';
import { TableField } from '../types';

/**
 * Utility functions for RDB system
 */

/**
 * Generate CORS headers for API responses
 */
export function getCorsHeaders(): { [key: string]: string } {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Amz-Date, Authorization, X-Api-Key',
  };
}

/**
 * Generate a secure API key
 */
export function generateApiKey(): string {
  const prefix = 'rdb';
  const randomBytes = crypto.randomBytes(32);
  const key = randomBytes.toString('hex');
  return `${prefix}_${key}`;
}

/**
 * Hash an API key for storage
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Capitalize a string
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert field type to GraphQL type
 */
export function getGraphQLType(fieldType: string): string {
  switch (fieldType?.toLowerCase()) {
    case 'number':
    case 'int':
    case 'integer':
      return 'Int';
    case 'float':
    case 'double':
      return 'Float';
    case 'boolean':
    case 'bool':
      return 'Boolean';
    case 'array':
    case 'list':
      return '[String]';
    default:
      return 'String';
  }
}

/**
 * Convert field type to DynamoDB attribute type
 */
export function getAttributeType(fieldType: string): 'S' | 'N' | 'B' {
  switch (fieldType?.toLowerCase()) {
    case 'number':
    case 'int':
    case 'integer':
    case 'float':
    case 'double':
      return 'N';
    default:
      return 'S';
  }
}

/**
 * Validate table field definitions
 */
export function validateTableFields(fields: TableField[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(fields) || fields.length === 0) {
    errors.push('Fields must be a non-empty array');
    return { valid: false, errors };
  }

  const fieldNames = new Set<string>();
  let primaryKeyCount = 0;

  for (const field of fields) {
    // Check required properties
    if (!field.name || typeof field.name !== 'string') {
      errors.push('Each field must have a valid name');
      continue;
    }

    // Check for duplicate field names
    if (fieldNames.has(field.name)) {
      errors.push(`Duplicate field name: ${field.name}`);
      continue;
    }
    fieldNames.add(field.name);

    // Validate field type
    const validTypes = ['String', 'Int', 'Float', 'Boolean', 'Array'];
    if (!validTypes.includes(field.type)) {
      errors.push(`Invalid field type for ${field.name}: ${field.type}`);
    }

    // Check primary key count
    if (field.primary) {
      primaryKeyCount++;
    }
  }

  // Ensure only one primary key
  if (primaryKeyCount > 1) {
    errors.push('Only one field can be marked as primary');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate table name
 */
export function validateTableName(tableName: string): { valid: boolean; error?: string } {
  if (!tableName || typeof tableName !== 'string') {
    return { valid: false, error: 'Table name must be a non-empty string' };
  }

  // Check length
  if (tableName.length < 3 || tableName.length > 50) {
    return { valid: false, error: 'Table name must be between 3 and 50 characters' };
  }

  // Check format (alphanumeric and underscore only, must start with letter)
  const nameRegex = /^[a-zA-Z][a-zA-Z0-9_]*$/;
  if (!nameRegex.test(tableName)) {
    return { valid: false, error: 'Table name must start with a letter and contain only letters, numbers, and underscores' };
  }

  return { valid: true };
}

/**
 * Create a standardized API response
 */
export function createApiResponse<T>(
  success: boolean,
  data?: T,
  message?: string,
  error?: string
): {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  timestamp: string;
} {
  return {
    success,
    data,
    message,
    error,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Parse pagination token
 */
export function parsePaginationToken(token?: string): any | null {
  if (!token) return null;
  
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    return null;
  }
}

/**
 * Create pagination token
 */
export function createPaginationToken(lastKey: any): string {
  return Buffer.from(JSON.stringify(lastKey)).toString('base64');
}

/**
 * Sanitize record data for storage
 */
export function sanitizeRecord(record: any, fields: TableField[]): any {
  const sanitized: any = {};
  const fieldMap = new Map(fields.map(f => [f.name, f]));

  for (const [key, value] of Object.entries(record)) {
    const field = fieldMap.get(key);
    
    if (field) {
      // Type conversion based on field type
      switch (field.type) {
        case 'Int':
          sanitized[key] = typeof value === 'number' ? Math.floor(value) : parseInt(String(value), 10);
          break;
        case 'Float':
          sanitized[key] = typeof value === 'number' ? value : parseFloat(String(value));
          break;
        case 'Boolean':
          sanitized[key] = Boolean(value);
          break;
        case 'Array':
          sanitized[key] = Array.isArray(value) ? value : [value];
          break;
        default:
          sanitized[key] = String(value);
      }
    } else {
      // Allow additional fields but convert to string
      sanitized[key] = String(value);
    }
  }

  // Add timestamps
  const now = new Date().toISOString();
  if (!sanitized.createdAt) {
    sanitized.createdAt = now;
  }
  sanitized.updatedAt = now;

  return sanitized;
}