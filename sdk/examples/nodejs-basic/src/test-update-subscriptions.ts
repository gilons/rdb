import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';

// Load environment variables
config();

async function testUpdateTableSubscriptions(): Promise<void> {
  console.log('📡 Testing Table Subscription Updates');
  console.log('====================================\n');

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

    // Define subscription configuration based on SDK types
    // Expected: { event: 'create' | 'update' | 'delete' | 'change'; filters?: Array<{...}> }[]
    console.log('📡 Preparing subscription configuration...');
    
    const subscriptions = [
      {
        event: 'create' as const,
        filters: [
          { 
            field: 'active', 
            type: 'Boolean',
            operator: 'eq' as const,
            value: true
          }
        ]
      },
      {
        event: 'update' as const
      },
      {
        event: 'delete' as const
      }
    ];

    console.log('📋 Subscription configuration:');
    console.log(JSON.stringify(subscriptions, null, 2));

    // Update the users table with subscriptions
    console.log('\n🔄 Updating users table with subscriptions...');
    
    try {
      const updateResult = await client.updateTable('users', {
        subscriptions: subscriptions
      });
      
      console.log('✅ Table updated successfully!');
      console.log('📊 Update Result:', JSON.stringify(updateResult, null, 2));
      
    } catch (updateError: any) {
      console.log('❌ Error updating table:', updateError.message);
      console.log('ℹ️  This might be expected if the subscription API is not yet implemented.');
      
      // Log more details about the error
      if (updateError.response) {
        console.log('� Error response:', updateError.response);
      }
    }

  } catch (error: any) {
    console.error('❌ Error in subscription update test:', error);
    
    // Check if it's an HTTP error
    if (error.message && (error.message.includes('403') || error.message.includes('401'))) {
      console.log('\n🔍 Debugging information:');
      console.log('- Check if RDB_API_KEY is valid');
      console.log('- Check if RDB_ENDPOINT is correct'); 
      console.log('- Verify AWS infrastructure is deployed');
      console.log('- Check IAM permissions for API Gateway and Lambda');
    }
    
    if (error.message && error.message.includes('404')) {
      console.log('\nℹ️  The subscription update API might not be implemented yet');
    }
    
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  process.exit(0);
});

// Run the test
if (require.main === module) {
  testUpdateTableSubscriptions().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}