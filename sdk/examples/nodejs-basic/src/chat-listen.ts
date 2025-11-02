import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';
import { MessageSchema, ChatTableNames } from './chat-schema';

// Load environment variables
config();

async function listenForMessages(): Promise<void> {
  console.log('💬 Starting Real-Time Chat Listener');
  console.log('===================================\n');

  const client = new RdbClient({
    endpoint: process.env.RDB_ENDPOINT!,
    apiKey: process.env.RDB_API_KEY!,
  });

  try {
    const messages = client.tableWithSchema(ChatTableNames.messages, MessageSchema);
    
    console.log('📡 Setting up real-time message subscriptions...');
    console.log('   Listening for messages in #general chat');
    console.log('   Filter: chatId = "general"\n');

    // Get current user (simulate different users)
    const currentUser = process.env.CHAT_USERNAME || 'Alice';
    console.log(`👤 Listening as: ${currentUser}\n`);

    // Get message ID to watch for updates (from environment or use a default)
    const watchMessageId = process.env.WATCH_MESSAGE_ID;

    // Subscribe to new messages in the general chat
    const newMessageSubscription = await messages.subscribe({
      event: 'create', // Listen for new messages being created
      filters: {
        chatId: 'general', // Only listen to general chat
      },
      onData: (data) => {
        // Don't show notifications for messages from the current user
        if (data.username === currentUser) {
          console.log(`🤫 Skipping own message: "${data.content}"`);
          return;
        }
        
        console.log('🆕 New message received:');
        console.log('   📅 Timestamp:', new Date().toISOString());
        console.log('   👤 From:', data.username);
        console.log('   💬 Message:', data.content);
        console.log('   🏷️ Chat:', data.chatId);
        console.log('   🆔 Message ID:', data.id);
        if (data.isEdited) {
          console.log('   ✏️ Edited at:', data.editedAt);
        }
        console.log('');
      },
      onError: (error) => {
        console.error('❌ New message subscription error:', error);
      }
    });

    console.log('📡 Connecting to new message subscription...\n');
    await newMessageSubscription.connect();
    console.log('✅ Listening for new messages in #general!\n');

    // Subscribe to message updates (UPDATE events) - filter by specific message ID
    let editSubscription = null;
    let deleteSubscription = null;
    
    if (watchMessageId) {
      console.log('📡 Setting up message update subscription...');
      console.log(`   Watching for updates to message ID: ${watchMessageId}\n`);

      editSubscription = await messages.subscribe({
        event: 'update', // Listen for message updates
        filters: {
          id: watchMessageId, // Only listen to updates for this specific message
        },
        onData: (data) => {
          console.log('✏️ Message updated:');
          console.log('   📅 Updated at:', new Date().toISOString());
          console.log('   🆔 Message ID:', data.id);
          console.log('   👤 Author:', data.username);
          console.log('   💬 New content:', data.content);
          console.log('   🏷️ Chat:', data.chatId);
          if (data.isEdited) {
            console.log('   ✏️ Edited at:', data.editedAt);
          }
          console.log('');
        },
        onError: (error) => {
          console.error('❌ Update subscription error:', error);
        }
      });
      
      await editSubscription.connect();
      console.log('✅ Listening for updates to the specified message!\n');

      // Subscribe to message deletes (DELETE events) - filter by specific message ID
      console.log('📡 Setting up message delete subscription...');
      console.log(`   Watching for deletion of message ID: ${watchMessageId}\n`);

      deleteSubscription = await messages.subscribe({
        event: 'delete', // Listen for message deletions
        filters: {
          id: watchMessageId, // Only listen to deletion of this specific message
        },
        onData: (data) => {
          console.log('🗑️  Message deleted:');
          console.log('   � Deleted at:', new Date().toISOString());
          console.log('   🆔 Message ID:', data.id);
          console.log('   👤 Was from:', data.username);
          console.log('   💬 Content was:', data.content);
          console.log('   🏷️ Chat:', data.chatId);
          console.log('');
        },
        onError: (error) => {
          console.error('❌ Delete subscription error:', error);
        }
      });
      
      await deleteSubscription.connect();
      console.log('✅ Listening for deletion of the specified message!\n');
    } else {
      console.log('�💡 To watch for message updates/deletes, set WATCH_MESSAGE_ID environment variable');
      console.log('   Example: WATCH_MESSAGE_ID=<message-id> npm run chat:listen\n');
    }
    
    console.log('💡 TIP: In another terminal, run:');
    console.log('   - `npm run chat:send` to send a new message');
    if (watchMessageId) {
      console.log(`   - \`WATCH_MESSAGE_ID=${watchMessageId} npm run chat:edit\` to edit the watched message`);
      console.log(`   - \`WATCH_MESSAGE_ID=${watchMessageId} npm run message:delete\` to delete the watched message`);
    }
    console.log('\n   Press Ctrl+C to stop listening\n');

    // Keep the process running
    const keepAliveInterval = setInterval(() => {
      // Keep event loop alive
    }, 1000);

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        console.log('\n\n👋 Shutting down chat listener...');
        clearInterval(keepAliveInterval);
        newMessageSubscription.disconnect();
        if (editSubscription) {
          editSubscription.disconnect();
        }
        if (deleteSubscription) {
          deleteSubscription.disconnect();
        }
        resolve();
      };
      
      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    
    if (error.message.includes('Failed to get table metadata')) {
      console.log('\n🔍 Make sure to run `npm run chat:setup` first!');
    }
  }
}

listenForMessages().catch(console.error);