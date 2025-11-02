import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';
import { MessageSchema, ChatTableNames } from './chat-schema';

// Load environment variables
config();

const WATCH_MESSAGE_ID = process.env.WATCH_MESSAGE_ID;

if (!WATCH_MESSAGE_ID) {
  console.error('❌ WATCH_MESSAGE_ID environment variable is required');
  console.log('\n💡 Usage: WATCH_MESSAGE_ID=<message-id> npm run message:delete');
  console.log('   Example: WATCH_MESSAGE_ID=abc123 npm run message:delete');
  process.exit(1);
}

async function deleteMessage() {
  console.log('🗑️  Deleting chat message');
  console.log('========================\n');

  const client = new RdbClient({
    endpoint: process.env.RDB_ENDPOINT!,
    apiKey: process.env.RDB_API_KEY!,
  });

  const messages = client.tableWithSchema(ChatTableNames.messages, MessageSchema);

  try {
    // First, get the message to show what we're deleting
    console.log('📖 Fetching message details...');
    const getMessage = await messages.get(WATCH_MESSAGE_ID!);
    
    if (!getMessage.success || !getMessage.data) {
      console.error('❌ Message not found:', WATCH_MESSAGE_ID);
      console.log('\n💡 Make sure the message ID is correct and the message exists.');
      console.log('   You can get a message ID by running `npm run chat:send`');
      process.exit(1);
    }

    console.log('\n📋 Message to delete:');
    console.log('   🆔 ID:', getMessage.data.id);
    console.log('   💬 Content:', getMessage.data.content);
    console.log('   👤 From:', getMessage.data.username);
    console.log('   🏷️ Chat:', getMessage.data.chatId);
    console.log('   📅 Created:', getMessage.data.createdAt);

    // Delete the message
    console.log('\n🗑️  Deleting message...');
    const result = await messages.delete(WATCH_MESSAGE_ID!);

    if (result.success) {
      console.log('✅ Message deleted successfully!');
      console.log('   Check the listener terminal - if you have a listener watching this message,');
      console.log('   you should see a real-time deletion notification!\n');
      
      console.log('💡 Tip: To see delete subscriptions in action:');
      console.log(`   1. In one terminal: WATCH_MESSAGE_ID=${WATCH_MESSAGE_ID} npm run chat:listen`);
      console.log(`   2. In another terminal: WATCH_MESSAGE_ID=${WATCH_MESSAGE_ID} npm run message:delete`);
    } else {
      console.error('❌ Failed to delete message:', result.message);
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    
    if (error.message.includes('Failed to get table metadata')) {
      console.log('\n🔍 Make sure to run `npm run chat:setup` first!');
    }
    process.exit(1);
  }
}

deleteMessage();
