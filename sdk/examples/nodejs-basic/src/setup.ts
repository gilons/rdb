import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
config();

async function setup(): Promise<void> {
  console.log('🔧 RDB SDK Setup Script');
  console.log('========================\n');

  // Check environment file
  await checkEnvironmentSetup();
  
  // Test connection if env vars are available
  if (process.env.RDB_ENDPOINT && process.env.RDB_API_KEY) {
    await testConnection();
    await createSampleTables();
  } else {
    console.log('⚠️  Skipping connection test - environment not configured');
  }

  console.log('\n✅ Setup complete!');
  console.log('\n🚀 Ready to run examples:');
  console.log('   npm run dev        # Basic comprehensive demo');
  console.log('   npm run crud       # CRUD operations demo');
  console.log('   npm run realtime   # Real-time subscriptions demo');
}

async function checkEnvironmentSetup(): Promise<void> {
  console.log('📋 Checking environment setup...');

  const envPath = path.join(__dirname, '..', '.env');
  const envExamplePath = path.join(__dirname, '..', 'env.example');

  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(envExamplePath)) {
      console.log('📄 Creating .env file from template...');
      fs.copyFileSync(envExamplePath, envPath);
      console.log('✅ Created .env file');
      console.log('⚠️  Please edit .env with your actual RDB API details:');
      console.log('   - RDB_ENDPOINT=https://your-api-gateway-id.execute-api.region.amazonaws.com/prod');
      console.log('   - RDB_API_KEY=your-api-key-here');
    } else {
      console.log('❌ No .env or env.example file found');
      console.log('Please create a .env file with your RDB configuration');
    }
    return;
  }

  console.log('✅ .env file exists');

  // Check required environment variables
  const requiredVars = ['RDB_ENDPOINT', 'RDB_API_KEY'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.log('⚠️  Missing required environment variables:');
    missingVars.forEach(varName => {
      console.log(`   - ${varName}`);
    });
    console.log('\nPlease update your .env file with the missing values');
  } else {
    console.log('✅ All required environment variables are set');
  }
}

async function testConnection(): Promise<void> {
  console.log('\n🔌 Testing RDB connection...');

  try {
    const client = new RdbClient({
      endpoint: process.env.RDB_ENDPOINT!,
      apiKey: process.env.RDB_API_KEY!,
    });

    // Test basic connectivity
    console.log('   Testing client initialization...');
    
    // Try to list tables (this will test both auth and AppSync config fetching)
    console.log('   Fetching AppSync configuration...');
    const tablesResponse = await client.listTables();
    const tables = tablesResponse.data?.items || [];
    
    console.log('✅ Connection successful!');
    console.log(`📊 Found ${tables.length} existing tables`);
    
    if (tables.length > 0) {
      console.log('   Existing tables:');
      tables.forEach(table => {
        console.log(`     - ${table.tableName}`);
      });
    }

  } catch (error: any) {
    console.error('❌ Connection failed:', error.message);
    console.log('\n🔧 Troubleshooting tips:');
    console.log('   1. Verify your RDB_ENDPOINT URL is correct');
    console.log('   2. Check that your RDB_API_KEY is valid');
    console.log('   3. Ensure your RDB API is deployed and running');
    console.log('   4. Confirm your API key has necessary permissions');
    throw error;
  }
}

async function createSampleTables(): Promise<void> {
  console.log('\n🏗️  Setting up sample tables for examples...');

  try {
    const client = new RdbClient({
      endpoint: process.env.RDB_ENDPOINT!,
      apiKey: process.env.RDB_API_KEY!,
    });

    // Table definitions for examples
    const tablesToCreate = [
      {
        tableName: 'users',
        fields: [
          { name: 'name', type: 'String' as const, required: true },
          { name: 'email', type: 'String' as const, required: true, indexed: true },
          { name: 'age', type: 'Int' as const, required: false },
          { name: 'active', type: 'Boolean' as const, required: false }
        ],
        description: 'Users table for basic examples'
      },
      {
        tableName: 'products',
        fields: [
          { name: 'name', type: 'String' as const, required: true },
          { name: 'price', type: 'Float' as const, required: true },
          { name: 'category', type: 'String' as const, required: true, indexed: true },
          { name: 'inStock', type: 'Boolean' as const, required: false },
          { name: 'tags', type: 'Array' as const, required: false }
        ],
        description: 'Products table for basic examples'
      },
      {
        tableName: 'todos',
        fields: [
          { name: 'title', type: 'String' as const, required: true },
          { name: 'description', type: 'String' as const, required: false },
          { name: 'completed', type: 'Boolean' as const, required: true },
          { name: 'priority', type: 'String' as const, required: true, indexed: true },
          { name: 'dueDate', type: 'String' as const, required: false, indexed: true },
          { name: 'tags', type: 'Array' as const, required: false }
        ],
        description: 'Todos table for CRUD demo'
      },
      {
        tableName: 'messages',
        fields: [
          { name: 'userId', type: 'String' as const, required: true, indexed: true },
          { name: 'content', type: 'String' as const, required: true },
          { name: 'channel', type: 'String' as const, required: true, indexed: true },
          { name: 'timestamp', type: 'String' as const, required: false }
        ],
        description: 'Messages table for real-time demo'
      }
    ];

    let created = 0;
    let skipped = 0;

    for (const tableConfig of tablesToCreate) {
      try {
        await client.createTable(tableConfig);
        console.log(`✅ Created table: ${tableConfig.tableName}`);
        created++;
      } catch (err: any) {
        if (err.message.includes('already exists')) {
          console.log(`ℹ️  Table already exists: ${tableConfig.tableName}`);
          skipped++;
        } else {
          console.error(`❌ Failed to create table ${tableConfig.tableName}:`, err.message);
        }
      }
    }

    console.log(`\n📊 Setup summary:`);
    console.log(`   Created: ${created} tables`);
    console.log(`   Skipped: ${skipped} tables (already exist)`);
    console.log(`   Total available: ${created + skipped} tables`);

  } catch (error) {
    console.error('❌ Error setting up sample tables:', error);
    console.log('ℹ️  You can still run the examples - tables will be created as needed');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Setup interrupted by user');
  process.exit(0);
});

// Run setup
if (require.main === module) {
  setup().catch((error) => {
    console.error('\n❌ Setup failed:', error);
    console.log('\n💡 Check the troubleshooting section in README.md for help');
    process.exit(1);
  });
}