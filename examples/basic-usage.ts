// examples/basic-usage.ts

import { RdbClient, createApiKey } from '../src/sdk';

async function basicExample() {
  // 1. Create an API key (one-time setup)
  const { apiKey, apiKeyId } = await createApiKey(
    'https://your-api-gateway-endpoint.execute-api.us-east-1.amazonaws.com/prod',
    'My App API Key',
    'API key for my awesome app'
  );

  console.log('Created API Key:', { apiKey, apiKeyId });

  // 2. Initialize the RDB client
  const rdb = new RdbClient({
    apiKey: apiKey,
    endpoint: 'https://your-api-gateway-endpoint.execute-api.us-east-1.amazonaws.com/prod',
    appSyncEndpoint: 'https://your-appsync-api.appsync-api.us-east-1.amazonaws.com/graphql',
    appSyncRegion: 'us-east-1',
    appSyncApiKey: 'your-appsync-api-key',
  });

  // 3. Create a table schema
  const tableConfig = {
    tableName: 'users',
    fields: [
      { name: 'userId', type: 'String' as const, required: true, primary: true },
      { name: 'name', type: 'String' as const, required: true },
      { name: 'email', type: 'String' as const, required: true },
      { name: 'age', type: 'Int' as const },
      { name: 'isActive', type: 'Boolean' as const },
    ],
    subscriptions: [
      {
        event: 'create' as const,
        filters: [{ field: 'isActive', type: 'Boolean' }],
      },
      {
        event: 'update' as const,
      },
    ],
    description: 'User management table',
  };

  // 4. Create the table
  try {
    const createResult = await rdb.createTable(tableConfig);
    console.log('Table created:', createResult);
  } catch (error) {
    console.log('Table might already exist:', error);
  }

  // 5. Get a table instance
  const usersTable = rdb.table('users');

  // 6. Create some records
  const user1 = await usersTable.create({
    userId: 'user-123',
    name: 'John Doe',
    email: 'john@example.com',
    age: 30,
    isActive: true,
  });
  console.log('Created user:', user1);

  const user2 = await usersTable.create({
    userId: 'user-456',
    name: 'Jane Smith',
    email: 'jane@example.com',
    age: 28,
    isActive: true,
  });
  console.log('Created user:', user2);

  // 7. List records
  const users = await usersTable.list({ limit: 10 });
  console.log('All users:', users);

  // 8. Set up real-time subscription
  const subscription = usersTable.subscribe({
    filters: { isActive: true },
    onData: (data) => {
      console.log('Real-time update received:', data);
    },
    onError: (error) => {
      console.error('Subscription error:', error);
    },
    onComplete: () => {
      console.log('Subscription completed');
    },
  });

  // Start the subscription (now async to fetch schema)
  await subscription.connect();

  // 9. Create another user to trigger the subscription
  setTimeout(async () => {
    await usersTable.create({
      userId: 'user-789',
      name: 'Bob Wilson',
      email: 'bob@example.com',
      age: 35,
      isActive: true,
    });
  }, 2000);

  // 10. Clean up after 10 seconds
  setTimeout(() => {
    subscription.disconnect();
    console.log('Example completed');
  }, 10000);
}

// Run the example
basicExample().catch(console.error);