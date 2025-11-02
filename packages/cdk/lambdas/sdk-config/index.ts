import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { AppSyncClient, ListApiKeysCommand } from '@aws-sdk/client-appsync';

const APPSYNC_API_GQL_URL = process.env.APPSYNC_API_GQL_URL!;
const APPSYNC_API_ID = process.env.APPSYNC_API_ID!;
const AWS_REGION = process.env.AWS_REGION!;

const app = new Hono();

// Enable CORS
app.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
});

/**
 * GET /sdk/config
 * Provide SDK configuration for AppSync endpoint and API key
 */
app.get('/sdk/config', async (c) => {
  try {
    // The authorizer has already validated the API key
    // Return AppSync configuration for real-time subscriptions
    
    const response = {
      appSync: {
        endpoint: APPSYNC_API_GQL_URL,
        region: AWS_REGION,
        apiKey: await getAppSyncApiKey(),
      },
      ttl: 3600, // Cache for 1 hour
    };

    return c.json(response);

  } catch (error) {
    console.error('Error fetching SDK configuration:', error);
    
    return c.json({
      error: 'Failed to fetch SDK configuration',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Get the AppSync API key
 */
async function getAppSyncApiKey(): Promise<string> {
  const client = new AppSyncClient({ region: AWS_REGION });
  
  try {
    const command = new ListApiKeysCommand({
      apiId: APPSYNC_API_ID,
    });
    
    const result = await client.send(command);
    
    if (!result.apiKeys || result.apiKeys.length === 0) {
      throw new Error('No API keys found for AppSync API');
    }
    
    // Return the first active API key
    const activeKey = result.apiKeys.find(key => 
      key.expires && key.expires > Math.floor(Date.now() / 1000)
    );
    
    if (!activeKey || !activeKey.id) {
      throw new Error('No active API key found');
    }
    
    return activeKey.id;
    
  } catch (error) {
    console.error('Error fetching AppSync API key:', error);
    throw error;
  }
}

// Export handler for Lambda
export const handler = handle(app);