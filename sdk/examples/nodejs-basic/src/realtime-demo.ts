import { config } from 'dotenv';
import { RdbClient, RdbTable } from '@realdb/client';
import { MessageSchema, MessageWithMeta, TableNames } from './schemas';

// Load environment variables
config();

async function realTimeDemo(): Promise<void> {
  console.log('🔴 RDB Real-time Subscriptions Demo');
  console.log('====================================\n');

  // Validate environment
  if (!process.env.RDB_ENDPOINT || !process.env.RDB_API_KEY) {
    console.error('❌ Missing environment variables. Check your .env file.');
    process.exit(1);
  }

  try {
    // Initialize client
    const client = new RdbClient({
      endpoint: process.env.RDB_ENDPOINT,
      apiKey: process.env.RDB_API_KEY,
    });

    console.log('✅ RDB Client initialized');

    // Create messages table if it doesn't exist
    await setupMessagesTable(client);

    // Start real-time monitoring
    await demonstrateSubscriptions(client);

  } catch (error) {
    console.error('❌ Error in real-time demo:', error);
    process.exit(1);
  }
}

async function setupMessagesTable(client: RdbClient): Promise<void> {
  console.log('📋 Setting up messages table...');
  
  try {
    await client.createTableFromSchema(TableNames.messages, MessageSchema, {
      description: 'Chat messages for real-time demo with Zod validation'
    });
    console.log('✅ Messages table created from Zod schema');
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      console.log('ℹ️  Messages table already exists');
    } else {
      throw error;
    }
  }
}

async function demonstrateSubscriptions(client: RdbClient): Promise<void> {
  // Use schema-based table instance for validation and type safety
  const messages = client.tableWithSchema(TableNames.messages, MessageSchema);
  
  console.log('\n🔊 Starting real-time subscriptions...');
  console.log('This demo will show you real-time data changes.\n');

  // Subscribe to real-time changes with full type safety
  console.log('📡 Subscribing to real-time message changes...');
  const subscription = await messages.subscribe({
    onData: (message: MessageWithMeta) => {
      // message is now fully typed as MessageWithMeta interface
      console.log('🔄 Message change detected:');
      console.log(`   ID: ${message.id}`);
      console.log(`   User: ${message.userId}`);
      console.log(`   Channel: ${message.channel}`);
      console.log(`   Content: ${message.content}`);
      console.log(`   Time: ${message.timestamp || 'N/A'}\n`);
    },
    onError: (error: any) => {
      console.error('❌ Subscription error:', error);
    },
    onComplete: () => {
      console.log('� Subscription completed');
    }
  });

  console.log('🎯 All subscriptions active! Now creating sample data...\n');
  
  // Simulate real-time activity
  await simulateActivity(messages);

  // Keep the demo running for a while to show real-time updates
  console.log('⏱️  Demo running for 30 seconds...');
  console.log('   (Press Ctrl+C to exit)\n');

  setTimeout(() => {
    console.log('\n🔇 Unsubscribing from events...');
    subscription.disconnect();
    
    console.log('✅ Demo completed successfully!');
    console.log('\n💡 Key takeaways:');
    console.log('   - Real-time subscriptions work automatically');
    console.log('   - AppSync WebSocket connection established transparently');
    console.log('   - No manual GraphQL schema updates needed');
    console.log('   - Type-safe event handlers with TypeScript');
    
    process.exit(0);
  }, 30000);
}

async function simulateActivity(messages: RdbTable<MessageWithMeta>): Promise<void> {
  const users = ['alice', 'bob', 'charlie', 'diana'];
  const channels = ['general', 'random', 'tech', 'announcements'];
  const sampleMessages = [
    'Hello everyone!',
    'How is everyone doing?',
    'Great work on the latest release!',
    'Anyone up for lunch?',
    'Check out this new feature!',
    'The weather is nice today.',
    'Happy Friday everyone!',
    'Good morning team!'
  ];

  console.log('🎭 Simulating chat activity...\n');

  // Create initial messages
  for (let i = 0; i < 3; i++) {
    const message: MessageWithMeta = {
      userId: users[Math.floor(Math.random() * users.length)],
      content: sampleMessages[Math.floor(Math.random() * sampleMessages.length)],
      channel: channels[Math.floor(Math.random() * channels.length)],
      timestamp: new Date().toISOString()
    };

    await messages.create(message);
    await sleep(2000); // 2 second delay
  }

  // Schedule message deletion (update operations not available in current SDK)
  setTimeout(async () => {
    try {
      const messagesResponse = await messages.list({ limit: 1 });
      const messagesList = messagesResponse.data?.items || [];
      if (messagesList.length > 0) {
        const messageToDelete = messagesList[0] as MessageWithMeta;
        if (messageToDelete.id) {
          await messages.delete(messageToDelete.id);
          console.log('🗑️  Deleted a message to demonstrate real-time updates');
        }
      }
    } catch (error) {
      console.log('Note: Could not delete message:', error);
    }
  }, 15000); // After 15 seconds

  // Add one more message near the end
  setTimeout(async () => {
    await messages.create({
      userId: 'system',
      content: 'Demo will end soon!',
      channel: 'announcements',
      timestamp: new Date().toISOString()
    });
  }, 25000); // After 25 seconds
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Real-time demo stopped by user');
  console.log('✅ All subscriptions cleaned up');
  process.exit(0);
});

// Run the demo
if (require.main === module) {
  realTimeDemo().catch((error) => {
    console.error('❌ Fatal error in real-time demo:', error);
    process.exit(1);
  });
}