import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const APPSYNC_API_ID = process.env.APPSYNC_API_ID!;
const AWS_REGION = process.env.AWS_REGION!;

/**
 * Lambda function to provide SDK configuration
 * Returns AppSync endpoint, region, and API key for real-time subscriptions
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('SDK Config request:', JSON.stringify(event, null, 2));

  try {
    // The authorizer has already validated the API key
    // Return AppSync configuration for real-time subscriptions
    
    const response = {
      appSync: {
        endpoint: `https://${APPSYNC_API_ID}.appsync.${AWS_REGION}.amazonaws.com/graphql`,
        region: AWS_REGION,
        apiKey: await getAppSyncApiKey(),
      },
      ttl: 3600, // Cache for 1 hour
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error fetching SDK configuration:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Failed to fetch SDK configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

/**
 * Get the AppSync API key
 */
async function getAppSyncApiKey(): Promise<string> {
  // Import AWS SDK v3
  const { AppSyncClient, ListApiKeysCommand } = await import('@aws-sdk/client-appsync');
  
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