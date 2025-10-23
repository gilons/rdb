import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';
import { UserSchema, TableNames } from './schemas';

// Load environment variables
config();

async function triggerUpdate(): Promise<void> {
  console.log('🔔 Triggering a user creation to test real-time subscription\n');

  const client = new RdbClient({
    endpoint: process.env.RDB_ENDPOINT!,
    apiKey: process.env.RDB_API_KEY!,
  });

  const users = client.tableWithSchema(TableNames.users, UserSchema);

  // Create a test user
  console.log('📝 Creating test user...');
  const result = await users.create({
    name: `Test User ${Date.now()}`,
    email: `test${Date.now()}@example.com`,
    age: 25,
    active: true,
  });

  if (result.success) {
    console.log('✅ User created successfully!');
    console.log('   Check the other terminal - you should see a real-time notification!\n');
    console.log('   Data:', JSON.stringify(result.data, null, 2));
  } else {
    console.error('❌ Failed to create user:', result.error);
  }
}

triggerUpdate().catch(console.error);
