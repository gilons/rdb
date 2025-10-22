import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';

// Load environment variables
config();

async function testListTables(): Promise<void> {
  console.log('📋 Testing listTables Method');
  console.log('============================\n');

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

    // Test listTables
    console.log('📊 Listing all tables...');
    const result = await client.listTables();

    console.log('✅ Tables retrieved successfully!');
    console.log('📊 Result:', JSON.stringify(result, null, 2));

    if (result.data?.items) {
      console.log(`\n📈 Summary: Found ${result.data.items.length} tables`);
      result.data.items.forEach((table: any, index: number) => {
        console.log(`   ${index + 1}. ${table.tableName} (ID: ${table.tableId})`);
        console.log(`      Fields: ${table.fields?.length || 0}`);
        console.log(`      Created: ${table.createdAt}`);
        console.log(`      Description: ${table.description || 'No description'}`);
      });
    }

  } catch (error: any) {
    console.error('❌ Error listing tables:', error);
    
    // Check if it's an HTTP error
    if (error.message && (error.message.includes('403') || error.message.includes('401'))) {
      console.log('\n🔍 Debugging information:');
      console.log('- Check if RDB_API_KEY is valid');
      console.log('- Check if RDB_ENDPOINT is correct');
      console.log('- Verify AWS infrastructure is deployed');
      console.log('- Check IAM permissions for API Gateway and Lambda');
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
  testListTables().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}