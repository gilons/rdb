import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';
import { UserSchema, TableNames } from './schemas';

// Load environment variables
config();

async function testRealTimeConnection(): Promise<void> {
  console.log('📡 Testing Real-Time Subscription to Users Table');
  console.log('==============================================\n');

  // Validate environment variables
  if (!process.env.RDB_ENDPOINT || !process.env.RDB_API_KEY) {
    console.error('❌ Missing RDB_ENDPOINT or RDB_API_KEY environment variables');
    process.exit(1);
  }

  try {
    // Initialize RDB client
    console.log('🔗 Initializing RDB Client...');
    const client = new RdbClient({
      endpoint: process.env.RDB_ENDPOINT,
      apiKey: process.env.RDB_API_KEY,
    });
    console.log('✅ Client initialized\n');

    // Get the users table with schema
    const users = client.tableWithSchema(TableNames.users, UserSchema);

    console.log('📡 Setting up real-time subscription...');
    console.log('   Listening for active user changes (create, update, delete)');
    console.log('   Filter: active = true\n');

    // Set up subscription with runtime filter
    const subscription = await users.subscribe({
      filters: {
        active: true, // Only receive events for active users
      },
      onData: (data) => {
        console.log('🔔 Real-time update received:');
        console.log('   Timestamp:', new Date().toISOString());
        console.log('   Data:', JSON.stringify(data, null, 2));
        console.log('');
      },
      onError: (error) => {
        console.error('❌ Subscription error:', error);
      },
      onComplete: () => {
        console.log('✅ Subscription completed');
      }
    });

    console.log('📡 Connecting to subscription...\n');

    // Connect to subscription and wait for it to be ready
    await subscription.connect();

    console.log('✅ Subscription active! Waiting for events...');
    console.log('   Press Ctrl+C to stop\n');
    console.log('💡 TIP: In another terminal, run operations to see real-time updates:');
    console.log('   - Create: Add a new user to see onCreate events');
    console.log('   - Update: Modify a user to see onUpdate events');
    console.log('   - Delete: Remove a user to see onDelete events\n');

    // Keep the process running indefinitely
    // Use setInterval to keep the event loop alive
    const keepAliveInterval = setInterval(() => {
      // This interval keeps Node.js event loop active
    }, 1000);

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        console.log('\n\n👋 Shutting down subscription...');
        clearInterval(keepAliveInterval);
        subscription.disconnect();
        resolve();
      };
      
      // Register cleanup handler
      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    
    // Provide helpful debugging information
    if (error.message.includes('AppSync')) {
      console.log('\n🔍 Troubleshooting:');
      console.log('- Ensure the table has subscriptions configured');
      console.log('- Check that the AppSync API is deployed');
      console.log('- Verify the API key has access to the AppSync endpoint');
    }
    
    if (error.message.includes('Failed to get table metadata') || error.message.includes('Failed to list tables')) {
      console.log('\n🔍 API Authorization Issue:');
      console.log('- Check if the API Gateway authorizer is working correctly');
      console.log('- Verify the X-Api-Key header is being sent correctly');
      console.log('- Check CloudWatch logs for the authorizer Lambda');
    }
    
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testRealTimeConnection().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
