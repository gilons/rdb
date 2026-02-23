/**
 * API Key Initialization Lambda
 * 
 * CDK Custom Resource handler for creating an API key during stack deployment.
 * This allows tables to be created under the correct API key namespace.
 */

import { 
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
  Context 
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { 
  SecretsManagerClient, 
  GetSecretValueCommand,
  PutSecretValueCommand 
} from '@aws-sdk/client-secrets-manager';
import * as crypto from 'crypto';

const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const secretsManager = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

const API_KEYS_TABLE_NAME = process.env.API_KEYS_TABLE_NAME!;
const SECRET_NAME = process.env.SECRET_NAME!;

interface ApiKeyInitProps {
  name: string;
  description?: string;
}

/**
 * Generate a secure API key
 */
function generateApiKey(): string {
  return `rdb_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Hash an API key for storage
 */
function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Create an API key
 */
async function createApiKey(name: string, description: string): Promise<{ apiKey: string; apiKeyId: string }> {
  const apiKey = generateApiKey();
  const apiKeyId = crypto.randomUUID();
  const keyHash = hashApiKey(apiKey);
  const timestamp = new Date().toISOString();

  // Store in DynamoDB
  await dynamodb.send(new PutCommand({
    TableName: API_KEYS_TABLE_NAME,
    Item: {
      apiKeyId,
      name,
      description,
      keyHash,
      createdAt: timestamp,
      isActive: true,
    },
  }));

  // Store the actual key in Secrets Manager
  try {
    const secretResponse = await secretsManager.send(new GetSecretValueCommand({
      SecretId: SECRET_NAME,
    }));

    let secrets: Record<string, any> = {};
    if (secretResponse.SecretString) {
      secrets = JSON.parse(secretResponse.SecretString);
    }

    secrets[apiKeyId] = {
      apiKey,
      name,
      description,
      createdAt: timestamp,
    };

    await secretsManager.send(new PutSecretValueCommand({
      SecretId: SECRET_NAME,
      SecretString: JSON.stringify(secrets),
    }));
  } catch (error) {
    console.error('Failed to store API key in Secrets Manager:', error);
    throw error;
  }

  return { apiKey, apiKeyId };
}

/**
 * Delete an API key
 */
async function deleteApiKey(apiKeyId: string): Promise<void> {
  // Delete from DynamoDB
  await dynamodb.send(new DeleteCommand({
    TableName: API_KEYS_TABLE_NAME,
    Key: { apiKeyId },
  }));

  // Remove from Secrets Manager
  try {
    const secretResponse = await secretsManager.send(new GetSecretValueCommand({
      SecretId: SECRET_NAME,
    }));

    if (secretResponse.SecretString) {
      const secrets = JSON.parse(secretResponse.SecretString);
      delete secrets[apiKeyId];

      await secretsManager.send(new PutSecretValueCommand({
        SecretId: SECRET_NAME,
        SecretString: JSON.stringify(secrets),
      }));
    }
  } catch (error) {
    console.warn('Failed to remove API key from Secrets Manager:', error);
  }
}

/**
 * CloudFormation Custom Resource handler
 */
export const handler = async (
  event: CloudFormationCustomResourceEvent,
  context: Context
): Promise<CloudFormationCustomResourceResponse> => {
  console.log('API Key init event:', JSON.stringify(event, null, 2));
  
  const { RequestType, ResourceProperties } = event;
  const props = ResourceProperties as unknown as ApiKeyInitProps & { ServiceToken: string };
  
  const existingPhysicalId = 'PhysicalResourceId' in event ? event.PhysicalResourceId : undefined;
  
  let status: 'SUCCESS' | 'FAILED' = 'SUCCESS';
  let reason = '';
  let data: Record<string, any> = {};
  let physicalResourceId = existingPhysicalId || '';

  try {
    switch (RequestType) {
      case 'Create': {
        console.log('Creating API key:', props.name);
        const { apiKey, apiKeyId } = await createApiKey(
          props.name || 'rdb-initial-key',
          props.description || 'Auto-provisioned API key for initial tables'
        );
        
        physicalResourceId = apiKeyId;
        data = {
          apiKey,
          apiKeyId,
          apiKeyHash: hashApiKey(apiKey),
        };
        
        console.log('API key created:', apiKeyId);
        break;
      }
      
      case 'Update': {
        // For updates, we keep the existing key
        console.log('Update requested - keeping existing API key');
        
        // Try to retrieve the existing key from Secrets Manager
        if (existingPhysicalId) {
          try {
            const secretResponse = await secretsManager.send(new GetSecretValueCommand({
              SecretId: SECRET_NAME,
            }));
            
            if (secretResponse.SecretString) {
              const secrets = JSON.parse(secretResponse.SecretString);
              const keyData = secrets[existingPhysicalId];
              
              if (keyData) {
                data = {
                  apiKey: keyData.apiKey,
                  apiKeyId: existingPhysicalId,
                  apiKeyHash: hashApiKey(keyData.apiKey),
                };
              }
            }
          } catch (error) {
            console.warn('Could not retrieve existing key:', error);
          }
        }
        
        physicalResourceId = existingPhysicalId || '';
        break;
      }
      
      case 'Delete': {
        console.log('Deleting API key:', existingPhysicalId);
        if (existingPhysicalId) {
          await deleteApiKey(existingPhysicalId);
        }
        data = { message: 'API key deleted' };
        break;
      }
    }
  } catch (error: any) {
    console.error('Error in API key init handler:', error);
    status = 'FAILED';
    reason = error.message || 'Unknown error';
  }

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
