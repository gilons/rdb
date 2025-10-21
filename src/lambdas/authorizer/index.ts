import { APIGatewayTokenAuthorizerEvent, APIGatewayAuthorizerResult, Context, APIGatewayEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  UpdateCommand 
} from '@aws-sdk/lib-dynamodb';
import { 
  SecretsManagerClient, 
  GetSecretValueCommand 
} from '@aws-sdk/client-secrets-manager';
import * as crypto from 'crypto';

const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const secretsManager = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

const API_KEYS_TABLE_NAME = process.env.API_KEYS_TABLE_NAME!;
const SECRET_NAME = process.env.SECRET_NAME!;

/**
 * Lambda authorizer for API Gateway
 * Validates API keys and returns authorization policy
 */
export const handler = async (
  event: APIGatewayEvent & {methodArn: string},
  context: Context
): Promise<APIGatewayAuthorizerResult> => {
  console.log('Authorizer invoked for token validation');

  const token = event.requestContext.identity.apiKey;
  
  if (!token || !token.startsWith('rdb_')) {
    console.log('Invalid token format or missing token');
    throw new Error('Unauthorized');
  }

  const tokenHash = getApiKeyHash(token);
  console.log('Validating token with hash:', tokenHash);

  try {
    // Validate the API key
    const apiKeyId = await validateApiKey(token);
    
    if (!apiKeyId) {
      throw new Error('Unauthorized');
    }

    // Update last used timestamp
    await updateLastUsed(apiKeyId);

    // Generate policy
    const policy = generatePolicy('user', 'Allow', event.methodArn, {
      apiKey: token,
      apiKeyId,
    });

    return policy;
  } catch (error) {
    console.error('Authorization failed:', error);
    throw new Error('Unauthorized');
  }
};

/**
 * Validate API key against stored hash
 */
async function validateApiKey(apiKey: string): Promise<string | null> {
  const keyHash = hashApiKey(apiKey);

  // Query DynamoDB for API key by hash
  const result = await dynamodb.send(new ScanCommand({
    TableName: API_KEYS_TABLE_NAME,
    FilterExpression: 'keyHash = :keyHash AND isActive = :isActive',
    ExpressionAttributeValues: {
      ':keyHash': keyHash,
      ':isActive': true,
    },
  }));

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const apiKeyItem = result.Items[0];
  
  // Verify the actual key from Secrets Manager for additional security
  try {
    const secret = await secretsManager.send(new GetSecretValueCommand({
      SecretId: SECRET_NAME, // Single consolidated secret
    }));

    if (secret.SecretString) {
      const allSecrets = JSON.parse(secret.SecretString);
      const apiKeyData = allSecrets[apiKeyItem.apiKeyId];
      
      if (apiKeyData && apiKeyData.apiKey === apiKey) {
        return apiKeyItem.apiKeyId;
      }
    }
  } catch (error) {
    console.error('Failed to verify API key from Secrets Manager:', sanitizeApiKeyForLogging(apiKey), error);
    return null;
  }

  return null;
}

/**
 * Hash an API key for comparison
 */
function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Update the last used timestamp for the API key
 */
async function updateLastUsed(apiKeyId: string): Promise<void> {
  try {
    await dynamodb.send(new UpdateCommand({
      TableName: API_KEYS_TABLE_NAME,
      Key: { apiKeyId },
      UpdateExpression: 'SET lastUsed = :timestamp',
      ExpressionAttributeValues: {
        ':timestamp': new Date().toISOString(),
      },
    }));
  } catch (error) {
    console.error('Failed to update last used timestamp:', error);
    // Don't throw - this is not critical for authorization
  }
}

/**
 * Generate IAM policy for API Gateway
 */
function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: { [key: string]: any }
): APIGatewayAuthorizerResult {
  const policy: APIGatewayAuthorizerResult = {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
  };

  if (context) {
    policy.context = context;
  }

  return policy;
}

/**
 * Generate a consistent hash for API key (for logging and identification)
 * This ensures API keys are never exposed in logs
 */
function getApiKeyHash(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 8);
}

/**
 * Sanitize API key for secure logging - only show first 4 chars and hash
 */
function sanitizeApiKeyForLogging(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) return '[INVALID_KEY]';
  const prefix = apiKey.substring(0, 4);
  const hash = getApiKeyHash(apiKey);
  return `${prefix}***[${hash}]`;
}