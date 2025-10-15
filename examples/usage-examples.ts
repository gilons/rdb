import { RdbClient, createApiKey } from '../src/sdk';

/**
 * RDB SDK Usage Examples
 */

// Example 1: Create API Key
async function example1_CreateApiKey() {
  console.log('=== Example 1: Creating API Key ===');
  
  try {
    const { apiKey, apiKeyId } = await createApiKey(
      'https://your-api-gateway-endpoint.amazonaws.com',
      'MyApp',
      'API key for my application'
    );
    
    console.log('API Key created:', { apiKey, apiKeyId });
    return apiKey;
  } catch (error) {
    console.error('Error creating API key:', error);
    throw error;
  }
}

// Example 2: Initialize RDB Client
function example2_InitializeClient(apiKey: string) {
  console.log('=== Example 2: Initialize RDB Client ===');
  
  const rdb = new RdbClient({
    apiKey,
    endpoint: 'https://your-api-gateway-endpoint.amazonaws.com',
    appSyncEndpoint: 'https://your-appsync-endpoint.amazonaws.com/graphql',
    region: 'us-east-1'
  });
  
  console.log('RDB Client initialized');
  return rdb;
}

// Example 3: Create a Table
async function example3_CreateTable(rdb: RdbClient) {
  console.log('=== Example 3: Create Table ===');
  
  try {
    const tableConfig = {
      tableName: 'users',
      fields: [
        { name: 'id', type: 'String' as const, required: true, primary: true },
        { name: 'email', type: 'String' as const, required: true, indexed: true },
        { name: 'name', type: 'String' as const, required: true },
        { name: 'age', type: 'Int' as const },
        { name: 'active', type: 'Boolean' as const }
      ],
      subscriptions: [
        {
          event: 'create' as const,
          filters: [{ field: 'active', type: 'Boolean', operator: 'eq' as const, value: true }]
        },
        {
          event: 'update' as const
        }
      ],
      description: 'User management table'
    };

    const response = await rdb.createTable(tableConfig);
    console.log('Table created:', response);
  } catch (error) {
    console.error('Error creating table:', error);
  }
}

// Example 4: List Tables
async function example4_ListTables(rdb: RdbClient) {
  console.log('=== Example 4: List Tables ===');
  
  try {
    const response = await rdb.listTables();
    console.log('Tables:', response.data?.items);
  } catch (error) {
    console.error('Error listing tables:', error);
  }
}

// Example 5: Table Operations
async function example5_TableOperations(rdb: RdbClient) {
  console.log('=== Example 5: Table Operations ===');
  
  const usersTable = rdb.table('users');
  
  try {
    // Create records
    console.log('Creating users...');
    
    const user1 = await usersTable.create({
      id: 'user1',
      email: 'john@example.com',
      name: 'John Doe',
      age: 30,
      active: true
    });
    console.log('User 1 created:', user1);

    const user2 = await usersTable.create({
      id: 'user2',
      email: 'jane@example.com',
      name: 'Jane Smith',
      age: 25,
      active: true
    });
    console.log('User 2 created:', user2);

    // List records
    console.log('Listing users...');
    const usersList = await usersTable.list({ limit: 10 });
    console.log('Users list:', usersList.data?.items);

    // Delete a record
    console.log('Deleting user1...');
    const deleteResult = await usersTable.delete('user1');
    console.log('Delete result:', deleteResult);

  } catch (error) {
    console.error('Error in table operations:', error);
  }
}

// Example 6: Real-time Subscriptions
async function example6_Subscriptions(rdb: RdbClient) {
  console.log('=== Example 6: Real-time Subscriptions ===');
  
  const usersTable = rdb.table('users');
  
  // Subscribe to user changes
  const subscription = usersTable.subscribe({
    filters: { active: true },
    onData: (data) => {
      console.log('Real-time update received:', data);
    },
    onError: (error) => {
      console.error('Subscription error:', error);
    },
    onComplete: () => {
      console.log('Subscription completed');
    }
  });

  // Start listening (now async to fetch schema)
  await subscription.connect();

  // Simulate some operations that would trigger updates
  setTimeout(async () => {
    console.log('Creating new user to trigger real-time update...');
    try {
      await usersTable.create({
        id: 'user3',
        email: 'bob@example.com',
        name: 'Bob Johnson',
        age: 35,
        active: true
      });
    } catch (error) {
      console.error('Error creating user:', error);
    }
  }, 2000);

  // Disconnect after 10 seconds
  setTimeout(() => {
    console.log('Disconnecting subscription...');
    subscription.disconnect();
  }, 10000);
}

// Example 7: Table Management
async function example7_TableManagement(rdb: RdbClient) {
  console.log('=== Example 7: Table Management ===');
  
  try {
    // Update table schema
    console.log('Updating table schema...');
    const updateResult = await rdb.updateTable('users', {
      fields: [
        { name: 'id', type: 'String' as const, required: true, primary: true },
        { name: 'email', type: 'String' as const, required: true, indexed: true },
        { name: 'name', type: 'String' as const, required: true },
        { name: 'age', type: 'Int' as const },
        { name: 'active', type: 'Boolean' as const },
        { name: 'createdAt', type: 'String' as const } // New field
      ],
      description: 'Updated user management table'
    });
    console.log('Table updated:', updateResult);

    // Note: Be careful with table deletion in production!
    // await rdb.deleteTable('users');

  } catch (error) {
    console.error('Error in table management:', error);
  }
}

// Run all examples
async function runExamples() {
  try {
    console.log('🚀 Starting RDB SDK Examples\n');

    // Note: Replace with your actual API endpoint
    const API_ENDPOINT = process.env.RDB_API_ENDPOINT || 'https://your-api-gateway-endpoint.amazonaws.com';
    
    // Step 1: Create API key (only needed once)
    // const apiKey = await example1_CreateApiKey();
    
    // Step 2: Use existing API key (replace with actual key)
    const apiKey = process.env.RDB_API_KEY || 'rdb_your_api_key_here';
    
    if (!apiKey.startsWith('rdb_')) {
      console.error('Please set RDB_API_KEY environment variable with a valid API key');
      return;
    }

    // Initialize client
    const rdb = example2_InitializeClient(apiKey);

    // Run examples
    await example3_CreateTable(rdb);
    await example4_ListTables(rdb);
    await example5_TableOperations(rdb);
    await example6_Subscriptions(rdb);
    
    // Wait a bit before table management
    setTimeout(async () => {
      await example7_TableManagement(rdb);
    }, 5000);

    console.log('\n✅ All examples completed!');
    
  } catch (error) {
    console.error('❌ Error running examples:', error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples();
}

export {
  example1_CreateApiKey,
  example2_InitializeClient,
  example3_CreateTable,
  example4_ListTables,
  example5_TableOperations,
  example6_Subscriptions,
  example7_TableManagement,
  runExamples
};