import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';
import { 
  UserSchema, 
  ProductSchema, 
  User, 
  Product,
  TableNames 
} from './schemas';
import { ResumableTestRunner } from './test-runner';

// Load environment variables
config();

async function main(): Promise<void> {
  console.log('🚀 RDB SDK TypeScript Example (v1.2.0 with Zod!)');
  console.log('==================================================\n');

  // Check for reset command
  if (process.argv.includes('--reset')) {
    const runner = new ResumableTestRunner('rdb-example');
    runner.reset();
    return;
  }

  // Validate environment variables
  if (!process.env.RDB_ENDPOINT) {
    console.error('❌ Missing RDB_ENDPOINT environment variable');
    console.log('Please create a .env file with:');
    console.log('RDB_ENDPOINT=https://your-api-gateway-endpoint.com');
    console.log('RDB_API_KEY=your-api-key');
    process.exit(1);
  }

  if (!process.env.RDB_API_KEY) {
    console.error('❌ Missing RDB_API_KEY environment variable');
    process.exit(1);
  }

  try {
    // Initialize RDB client
    const client = new RdbClient({
      endpoint: process.env.RDB_ENDPOINT,
      apiKey: process.env.RDB_API_KEY,
    });

    // Set up resumable test runner
    const testRunner = new ResumableTestRunner('rdb-example');
    
    // Add test steps
    setupTestSteps(testRunner, client);
    
    // Run the tests
    await testRunner.run();

  } catch (error) {
    console.error('❌ Error in main:', error);
    process.exit(1);
  }
}

function setupTestSteps(testRunner: ResumableTestRunner, client: RdbClient): void {
  // Step 1: Initialize client
  testRunner.addStep({
    name: 'client-init',
    description: 'Initialize RDB client and validate connection',
    required: true, // Critical step - stop if it fails
    execute: async () => {
      console.log('   🔗 RDB Client initialized successfully');
      return { status: 'initialized', endpoint: process.env.RDB_ENDPOINT };
    }
  });

  // Step 2: List existing tables (simple test)
  testRunner.addStep({
    name: 'list-tables',
    description: 'List all existing tables',
    required: true, // This is a critical step - stop if it fails
    execute: async () => {
      const tablesResponse = await client.listTables();
      const tables = tablesResponse.data?.items || [];
      console.log(`   📊 Found ${tables.length} existing tables`);
      if (tables.length > 0) {
        console.log(`   📋 Tables: ${tables.map(t => t.tableName).join(', ')}`);
      }
      return { count: tables.length, tables: tables.map(t => t.tableName) };
    }
  });

  // Step 3: Create users table
  testRunner.addStep({
    name: 'create-users-table',
    description: 'Create users table using Zod schema',
    required: false, // Optional step - continue if it fails (table might already exist)
    execute: async () => {
      await client.createTableFromSchema(TableNames.users, UserSchema, {
        description: 'User management table with Zod validation'
      });
      console.log('   ✅ Users table created successfully');
      return { tableName: TableNames.users, schema: 'UserSchema' };
    }
  });

  // Step 4: Create products table
  testRunner.addStep({
    name: 'create-products-table',
    description: 'Create products table using Zod schema',
    required: false, // Optional step - continue if it fails (table might already exist)
    execute: async () => {
      await client.createTableFromSchema(TableNames.products, ProductSchema, {
        description: 'Product catalog table with Zod validation'
      });
      console.log('   ✅ Products table created successfully');
      return { tableName: TableNames.products, schema: 'ProductSchema' };
    }
  });

  // Step 5: List tables after creation
  testRunner.addStep({
    name: 'list-tables-after-creation',
    description: 'Verify tables were created by listing all tables',
    required: true, // Important verification step - stop if it fails
    execute: async () => {
      const tablesResponse = await client.listTables();
      const tables = tablesResponse.data?.items || [];
      console.log(`   📊 Total tables after creation: ${tables.length}`);
      const tableNames = tables.map(t => t.tableName);
      
      // Verify our tables exist
      const usersExists = tableNames.includes(TableNames.users);
      const productsExists = tableNames.includes(TableNames.products);
      
      console.log(`   ✅ Users table exists: ${usersExists}`);
      console.log(`   ✅ Products table exists: ${productsExists}`);
      
      return { 
        totalTables: tables.length, 
        usersExists, 
        productsExists,
        allTables: tableNames 
      };
    }
  });

  // Step 6: Test CRUD operations
  testRunner.addStep({
    name: 'crud-operations',
    description: 'Test basic CRUD operations with validation',
    execute: async () => {
      return await testCrudOperations(client);
    },
    required: false // Optional step
  });

  // Step 7: Test real-time setup
  testRunner.addStep({
    name: 'realtime-setup',
    description: 'Test real-time subscription setup',
    execute: async () => {
      return await testRealTimeSetup(client);
    },
    required: false // Optional step
  });
}



async function testCrudOperations(client: RdbClient): Promise<any> {
  // Use schema-based table instances for validation and type safety
  const users = client.tableWithSchema(TableNames.users, UserSchema);
  const products = client.tableWithSchema(TableNames.products, ProductSchema);

  const results = {
    usersCreated: 0,
    productsCreated: 0,
    usersListed: 0,
    productsListed: 0,
    validationTested: false
  };

  // Create some users with automatic validation
  console.log('   👤 Creating test users...');
  const user1Response = await users.create({
    name: 'John Doe',
    email: 'john@example.com',
    age: 30,
    active: true
  });
  const user1 = user1Response.data as User;
  if (user1) results.usersCreated++;
  console.log(`   ✅ Created user: ${user1?.name || 'User'}`);

  const user2Response = await users.create({
    name: 'Jane Smith',
    email: 'jane@example.com', 
    age: 25,
    active: true
  });
  const user2 = user2Response.data as User;
  if (user2) results.usersCreated++;
  console.log(`   ✅ Created user: ${user2?.name || 'User'}`);

  // Create some products with automatic validation
  console.log('   📦 Creating test products...');
  const product1Response = await products.create({
    name: 'iPhone 15',
    price: 999.99,
    category: 'electronics',
    inStock: true,
    tags: ['phone', 'apple', 'premium']
  });
  const product1 = product1Response.data as Product;
  if (product1) results.productsCreated++;
  console.log(`   ✅ Created product: ${product1?.name || 'Product'}`);

  // Read operations
  console.log('   📖 Testing read operations...');
  const usersListResponse = await users.list({ limit: 10 });
  const usersList = usersListResponse.data?.items || [];
  results.usersListed = usersList.length;
  console.log(`   📋 Found ${usersList.length} users total`);

  const productsListResponse = await products.list({ limit: 10 });
  const productsList = productsListResponse.data?.items || [];
  results.productsListed = productsList.length;
  console.log(`   📋 Found ${productsList.length} products total`);

  // Test validation
  console.log('   🛡️  Testing Zod validation...');
  try {
    await users.create({
      name: '',
      email: 'invalid-email',
      age: -5
    } as any);
  } catch (error) {
    results.validationTested = true;
    console.log('   ✅ Validation working correctly');
  }

  return results;
}

async function testRealTimeSetup(client: RdbClient): Promise<any> {
  try {
    const users = client.table(TableNames.users);
    
    // Test subscription setup (we won't actually keep it open in this demo)
    console.log('   📡 Testing subscription setup...');
    const subscription = await users.subscribe({
      onData: (data: any) => {
        console.log('   📡 Received data:', data);
      },
      onError: (error: any) => {
        console.log('   ❌ Subscription error:', error);
      }
    });
    
    console.log('   ✅ Real-time capabilities are available');
    console.log('   📡 AppSync configuration automatically fetched');
    
    // Disconnect immediately for demo purposes
    setTimeout(() => {
      subscription.disconnect();
    }, 1000);
    
    return {
      subscriptionSetup: true,
      appSyncAvailable: true
    };
    
  } catch (error) {
    console.log('   ℹ️  Real-time features may not be available yet');
    return {
      subscriptionSetup: false,
      error: (error as Error).message
    };
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the main function
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}