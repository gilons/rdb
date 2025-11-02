import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { 
  SecretsManagerClient, 
  CreateSecretCommand, 
  UpdateSecretCommand,
  GetSecretValueCommand
} from '@aws-sdk/client-secrets-manager';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const secretsManager = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

const API_KEYS_TABLE_NAME = process.env.API_KEYS_TABLE_NAME!;
const SECRET_NAME = process.env.SECRET_NAME!;

interface ApiKeyRequest {
  name: string;
  description?: string;
}

interface ApiKeyItem {
  apiKeyId: string;
  name: string;
  description: string;
  keyHash: string;
  createdAt: string;
  lastUsed?: string;
  isActive: boolean;
}

const app = new Hono();

// Enable CORS
app.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Amz-Date, Authorization, X-Api-Key');
});

/**
 * POST /api-keys
 * Create a new API key
 */
app.post('/api-keys', async (c) => {
  try {
    const request = await c.req.json<ApiKeyRequest>();
    const { name, description } = request;

    if (!name) {
      return c.json({ error: 'name is required' }, 400);
    }

    // Generate API key
    const apiKeyId = uuidv4();
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    const timestamp = new Date().toISOString();

    const apiKeyItem: ApiKeyItem = {
      apiKeyId,
      name,
      description: description || '',
      keyHash,
      createdAt: timestamp,
      isActive: true,
    };

    // Store API key metadata in DynamoDB
    await dynamodb.send(new PutCommand({
      TableName: API_KEYS_TABLE_NAME,
      Item: apiKeyItem,
    }));

    // Store the actual API key in Secrets Manager (encrypted)
    await storeApiKeySecret(apiKeyId, apiKey);

    // Log creation without exposing the full API key
    console.log('API key created successfully for:', {
      apiKeyId,
      name,
      apiKeyHash: getApiKeyHash(apiKey),
      description: description || '',
      createdAt: timestamp,
    });

    return c.json({
      message: 'API key created successfully',
      apiKey, // Only return the actual key on creation
      apiKeyId,
      name,
      description: description || '',
      createdAt: timestamp,
    }, 201);

  } catch (error) {
    console.error('Failed to create API key:', error);
    return c.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Generate a secure API key
 */
function generateApiKey(): string {
  const prefix = 'rdb';
  const randomBytes = crypto.randomBytes(32);
  const key = randomBytes.toString('hex');
  return `${prefix}_${key}`;
}

/**
 * Hash an API key for storage
 */
function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Store API key in a single JSON secret (much more cost-effective)
 * All API keys are stored in one secret as a JSON object
 */
async function storeApiKeySecret(apiKeyId: string, apiKey: string): Promise<void> {
  const secretName = SECRET_NAME; // Single secret for all API keys
  const timestamp = new Date().toISOString();
  
  try {
    // Try to get existing secret first
    let existingSecrets: { [key: string]: any } = {};
    
    try {
      const existingSecret = await secretsManager.send(new GetSecretValueCommand({
        SecretId: secretName,
      }));
      
      if (existingSecret.SecretString) {
        existingSecrets = JSON.parse(existingSecret.SecretString);
      }
    } catch (error: any) {
      if (error.name !== 'ResourceNotFoundException') {
        throw error;
      }
      // Secret doesn't exist yet, will create new one
    }
    
    // Add or update the API key in the secrets object
    existingSecrets[apiKeyId] = {
      apiKey,
      createdAt: existingSecrets[apiKeyId]?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    
    const secretString = JSON.stringify(existingSecrets, null, 2);
    
    // Check size limit (64KB)
    if (Buffer.byteLength(secretString, 'utf8') > 64000) {
      throw new Error('Secret size limit exceeded. Consider implementing secret rotation or cleanup.');
    }
    
    try {
      // Try to update existing secret
      await secretsManager.send(new UpdateSecretCommand({
        SecretId: secretName,
        SecretString: secretString,
      }));
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        // Create new secret if it doesn't exist
        await secretsManager.send(new CreateSecretCommand({
          Name: secretName,
          SecretString: secretString,
          Description: 'RDB API Keys - All API keys stored in single secret for cost efficiency',
        }));
      } else {
        throw error;
      }
    }
    
    console.log(`API key ${getApiKeyHash(apiKey)} stored successfully in consolidated secret`);
    
  } catch (error: any) {
    console.error('Failed to store API key in Secrets Manager:', error.message);
    throw error;
  }
}

/**
 * Generate a consistent hash for API key (for logging and identification)
 * This ensures API keys are never exposed in logs
 */
function getApiKeyHash(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 8);
}

// Export handler for Lambda
export const handler = handle(app);