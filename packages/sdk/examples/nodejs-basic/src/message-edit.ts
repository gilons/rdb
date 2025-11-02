import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';
import { MessageSchema, ChatTableNames } from './chat-schema';

// Load environment variables
config();

async function editMessage(): Promise<void> {
  console.log('✏️ Message Edit Test\n');

  const client = new RdbClient({
    endpoint: process.env.RDB_ENDPOINT!,
    apiKey: process.env.RDB_API_KEY!,
  });

  const messages = client.tableWithSchema(ChatTableNames.messages, MessageSchema);

  try {
    // Get message ID from environment variable
    const messageId = process.env.WATCH_MESSAGE_ID;

    if (!messageId) {
      console.log('❌ Please provide WATCH_MESSAGE_ID environment variable');
      console.log('   Example: WATCH_MESSAGE_ID=<message-id> npm run chat:edit');
      console.log('\n📋 Listing existing messages to find IDs...\n');
      
      // List existing messages
      const listResult = await messages.list({ limit: 10 });
      
      if (!listResult.success || !listResult.data?.items.length) {
        console.log('❌ No messages found. Run `npm run chat:send` first to create some messages.');
        return;
      }

      console.log('📝 Available messages:');
      listResult.data.items.forEach((msg: any, index: number) => {
        console.log(`   ${index + 1}. "${msg.content}"`);
        console.log(`      ID: ${msg.id}`);
        console.log(`      By: ${msg.username} in #${msg.chatId}`);
        console.log('');
      });
      
      console.log('💡 Copy one of the IDs above and use:');
      console.log('   WATCH_MESSAGE_ID=<id> npm run chat:edit');
      return;
    }

    console.log(`🔍 Finding message with ID: ${messageId}\n`);

    // Get the current message
    const getMessage = await messages.get(messageId);

    console.warn('getMessage:', getMessage);
    
    if (!getMessage.success || !getMessage.data) {
      console.log(`❌ Message with ID ${messageId} not found.`);
      console.log('   Run the command without WATCH_MESSAGE_ID to see available messages.');
      return;
    }

    const currentMessage = getMessage.data;
    console.log('📝 Current message:');
    console.log(`   Content: "${currentMessage.content}"`);
    console.log(`   Author: ${currentMessage.username}`);
    console.log(`   Chat: #${currentMessage.chatId}`);
    console.log(`   Edited: ${currentMessage.isEdited ? 'Yes' : 'No'}`);
    console.log('');

    // Create updated content
    const newContent = `${currentMessage.content} [EDITED at ${new Date().toLocaleTimeString()}]`;
    const editedAt = new Date().toISOString();

    console.log(`✏️ Updating message to: "${newContent}"\n`);

    // Update the message using the SDK update() method
    const updateResult = await messages.update(messageId, {
      content: newContent,
      isEdited: true,
      editedAt: editedAt,
    });

    if (!updateResult.success) {
      console.log('❌ Failed to update message');
      return;
    }

    console.log('✅ Message updated successfully!\n');
    console.log('📝 Updated message:');
    console.log(`   Content: "${updateResult.data!.content}"`);
    console.log(`   Edited: ${updateResult.data!.isEdited ? 'Yes' : 'No'}`);
    console.log(`   Edited At: ${updateResult.data!.editedAt}`);
    console.log('');
    console.log('💡 If you have chat:listen running with WATCH_MESSAGE_ID set,');
    console.log('   it should receive the update notification now!');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

editMessage().catch(console.error);