import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';
import { UserSchema, TableNames } from './schemas';

// Load environment variables
config();

async function testCreateTableFromSchema(): Promise<void> {
  console.log('🧪 Testing createTableFromSchema Method');
  console.log('=====================================\n');

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

    // Test createTableFromSchema
    console.log('📋 Testing createTableFromSchema with UserSchema...');
    console.log(`   Table name: ${TableNames.users}`);
    console.log('   Schema: UserSchema (Zod validation)');
    console.log('   Description: Test table creation\n');

    const result = await client.createTableFromSchema(TableNames.users, UserSchema, {
      description: 'Test table creation with Zod schema'
    });

    console.log('✅ Table created successfully!');
    console.log('📊 Result:', JSON.stringify(result, null, 2));

  } catch (error: any) {
    console.error('❌ Error creating table:', error);
    
    // Check if it's an HTTP error
    if (error.message && (error.message.includes('403') || error.message.includes('401'))) {
      console.log('\n🔍 Debugging information:');
      console.log('- Check if RDB_API_KEY is valid');
      console.log('- Check if RDB_ENDPOINT is correct');
      console.log('- Verify AWS infrastructure is deployed');
      console.log('- Check IAM permissions for API Gateway and Lambda');
    }
    
    if (error.message && error.message.includes('409')) {
      console.log('\nℹ️  Table might already exist - this is normal');
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
  testCreateTableFromSchema().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}