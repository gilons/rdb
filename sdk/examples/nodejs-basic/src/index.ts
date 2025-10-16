import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';

// Load environment variables
config();

interface User {
  id?: string;
  name: string;
  email: string;
  age: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface Product {
  id?: string;
  name: string;
  price: number;
  category: string;
  inStock: boolean;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

async function main(): Promise<void> {
  console.log('🚀 RDB SDK TypeScript Example');
  console.log('===============================\n');

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
    // Initialize RDB client - AppSync config is automatically fetched
    const client = new RdbClient({
      endpoint: process.env.RDB_ENDPOINT,
      apiKey: process.env.RDB_API_KEY,
    });

    console.log('✅ RDB Client initialized successfully');
    
    // Demonstrate basic functionality
    await demonstrateTableManagement(client);
    await demonstrateCrudOperations(client);
    await demonstrateRealTimeSubscriptions(client);

  } catch (error) {
    console.error('❌ Error in main:', error);
    process.exit(1);
  }
}

async function demonstrateTableManagement(client: RdbClient): Promise<void> {
  console.log('\n📋 Table Management Demo');
  console.log('-------------------------');

  try {
    // Create a users table
    console.log('Creating users table...');
    await client.createTable({
      tableName: 'users',
      fields: [
        { name: 'name', type: 'String', required: true },
        { name: 'email', type: 'String', required: true, indexed: true },
        { name: 'age', type: 'Int', required: false },
        { name: 'active', type: 'Boolean', required: false }
      ],
      description: 'User management table'
    });
    console.log('✅ Users table created');

    // Create a products table
    console.log('Creating products table...');
    await client.createTable({
      tableName: 'products',
      fields: [
        { name: 'name', type: 'String', required: true },
        { name: 'price', type: 'Float', required: true },
        { name: 'category', type: 'String', required: true, indexed: true },
        { name: 'inStock', type: 'Boolean', required: false },
        { name: 'tags', type: 'Array', required: false }
      ],
      description: 'Product catalog table'
    });
    console.log('✅ Products table created');

    // List all tables
    const tablesResponse = await client.listTables();
    const tables = tablesResponse.data?.items || [];
    console.log(`📊 Found ${tables.length} tables:`, tables.map(t => t.tableName));

  } catch (error: any) {
    if (error.message.includes('already exists')) {
      console.log('ℹ️  Tables already exist, continuing...');
    } else {
      console.error('❌ Error in table management:', error);
      throw error;
    }
  }
}

async function demonstrateCrudOperations(client: RdbClient): Promise<void> {
  console.log('\n💾 CRUD Operations Demo');
  console.log('------------------------');

  try {
    // Use typed table instances for better IntelliSense and type safety
    const users = client.table<User>('users');
    const products = client.table<Product>('products');

    // Create some users
    console.log('Creating users...');
    const user1Response = await users.create({
      name: 'John Doe',
      email: 'john@example.com',
      age: 30,
      active: true
    });
    const user1 = user1Response.data as User;
    console.log('✅ Created user:', user1?.name || 'User');

    const user2Response = await users.create({
      name: 'Jane Smith',
      email: 'jane@example.com', 
      age: 25,
      active: true
    });
    const user2 = user2Response.data as User;
    console.log('✅ Created user:', user2?.name || 'User');

    // Create some products
    console.log('Creating products...');
    const product1Response = await products.create({
      name: 'iPhone 15',
      price: 999.99,
      category: 'electronics',
      inStock: true,
      tags: ['phone', 'apple', 'premium']
    });
    const product1 = product1Response.data as Product;
    console.log('✅ Created product:', product1?.name || 'Product');

    const product2Response = await products.create({
      name: 'MacBook Pro',
      price: 2499.99,
      category: 'computers',
      inStock: true,
      tags: ['laptop', 'apple', 'professional']
    });
    const product2 = product2Response.data as Product;
    console.log('✅ Created product:', product2?.name || 'Product');

    // Read operations
    console.log('\nReading data...');
    const usersListResponse = await users.list({ limit: 10 });
    const usersList = usersListResponse.data?.items || [];
    console.log(`📋 Found ${usersList.length} users`);

    const productsListResponse = await products.list({ limit: 10 });
    const productsList = productsListResponse.data?.items || [];
    console.log(`📋 Found ${productsList.length} products`);

    // Note: Update operations are not available in this SDK version
    console.log('\nNote: Update operations require additional API endpoints');

    // Note: We don't delete the records here so they're available for real-time demo

  } catch (error) {
    console.error('❌ Error in CRUD operations:', error);
    throw error;
  }
}

async function demonstrateRealTimeSubscriptions(client: RdbClient): Promise<void> {
  console.log('\n🔴 Real-time Subscriptions Demo');
  console.log('--------------------------------');
  console.log('This would demonstrate real-time subscriptions...');
  console.log('(Run `npm run realtime` for a full real-time demo)');

  try {
    const users = client.table('users');
    
    // Test subscription setup (we won't actually keep it open in this demo)
    console.log('Testing subscription setup...');
    const subscription = await users.subscribe({
      onData: (data: any) => {
        console.log('📡 Received data:', data);
      },
      onError: (error: any) => {
        console.log('❌ Subscription error:', error);
      }
    });
    
    console.log('✅ Real-time capabilities are available');
    console.log('📡 AppSync configuration automatically fetched from API');
    
    // Disconnect immediately for demo purposes
    setTimeout(() => {
      subscription.disconnect();
    }, 1000);
    
  } catch (error) {
    console.error('❌ Error setting up subscriptions:', error);
    console.log('ℹ️  Real-time features may not be available');
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