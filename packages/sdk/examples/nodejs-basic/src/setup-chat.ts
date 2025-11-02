import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';
import { MessageSchema, ChatTableNames, Message } from './chat-schema';

// Load environment variables
config();

async function setupChatTable(): Promise<void> {
  console.log('🚀 Setting up Messages Table for Chat System\n');

  const client = new RdbClient({
    endpoint: process.env.RDB_ENDPOINT!,
    apiKey: process.env.RDB_API_KEY!,
  });

  try {
    // Check if messages table already exists
    console.log('🔍 Checking if messages table already exists...');
    
    const tables = await client.listTables();
    const messagesTableExists = tables.success && 
      tables.data?.items.some(table => table.tableName === ChatTableNames.messages);

    if (messagesTableExists) {
      console.log('🔄 Messages table exists but may have incorrect schema.');
      console.log('   Deleting and recreating with proper ID field as primary key...');
      
      // Delete existing table
      const deleteResult = await client.deleteTable(ChatTableNames.messages);
      if (deleteResult.success) {
        console.log('✅ Existing table deleted successfully');
      } else {
        console.log('⚠️ Failed to delete existing table:', deleteResult.error);
      }
      
      // Wait for deletion to complete
      console.log('⏳ Waiting for table deletion to complete (10 seconds)...');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    // Create the new table with proper schema
    console.log('📋 Creating messages table with auto-generated ID as primary key...');
    console.log('   Setting up indexed fields for efficient queries:');
    console.log('   - chatId: for filtering messages by chat room');
    console.log('   - username: for filtering messages by user');
    const tableResult = await client.createTableFromSchema(ChatTableNames.messages, MessageSchema, {
      description: 'Chat messages table with real-time updates',
      indexedFields: ['chatId', 'username'],
      subscriptions: [
        {
          
          filters: [
            { field: 'chatId', type: 'string' }, // Filter by chat ID
            { field: 'username', type: 'string' }, // Filter by username
            { field: 'id', type: 'string' } // Filter by message ID (for updates)
          ]
        }
      ]
    });

    if (tableResult.success) {
      console.log('✅ Messages table created successfully!');
      console.log('   Table supports real-time subscriptions for:');
      console.log('   - New messages in specific chats (by chatId)');
      console.log('   - Message edits (by message id)');
      console.log('   - Message deletions (by message id)');
      console.log('');
      
      console.log('⏳ Waiting for schema propagation and resolver creation (45 seconds)...');
      console.log('   This ensures AppSync has fully processed the new table schema...');
      await new Promise(resolve => setTimeout(resolve, 45000));
      
      // Test creating some initial messages
      const messages = client.tableWithSchema(ChatTableNames.messages, MessageSchema);
      
      console.log('💬 Creating initial test messages...');
      
      const testMessages: Omit<Message, 'id' | 'timestamp'>[] = [
        {
          chatId: 'general',
          content: 'Hello everyone! 👋',
          userId: 'user1',
          username: 'Alice',
          isEdited: false
        },
        {
          chatId: 'general', 
          content: 'How is everyone doing?',
          userId: 'user2',
          username: 'Bob',
          isEdited: false
        },
        {
          chatId: 'dev-team',
          content: 'Ready for the standup?',
          userId: 'user1', 
          username: 'Alice',
          isEdited: false
        }
      ];

      let successCount = 0;
      let failCount = 0;
      
      for (const message of testMessages) {
        let retries = 3;
        let created = false;
        
        while (retries > 0 && !created) {
          try {
            const createResult = await messages.create({
              ...message,
              timestamp: new Date().toISOString()
            });
            
            if (createResult.success) {
              console.log(`   ✅ Created: "${message.content}" in #${message.chatId}`);
              console.log(`       🆔 Message ID: ${createResult.data?.id || (createResult.data as any)?.name || 'No ID returned'}`);
              successCount++;
              created = true;
            } else {
              console.log(`   ❌ Failed to create message (${4 - retries}/3): ${createResult.error}`);
              retries--;
              
              if (retries > 0) {
                console.log(`      ⏳ Retrying in 10 seconds... (${retries} attempts remaining)`);
                await new Promise(resolve => setTimeout(resolve, 10000));
              } else {
                failCount++;
              }
            }
          } catch (error: any) {
            console.log(`   ❌ Error creating message (${4 - retries}/3): ${error.message}`);
            retries--;
            
            if (retries > 0) {
              console.log(`      ⏳ Retrying in 10 seconds... (${retries} attempts remaining)`);
              await new Promise(resolve => setTimeout(resolve, 10000));
            } else {
              failCount++;
            }
          }
        }
        
        // Small delay between successful message creations
        if (created) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log(`\n📊 Test messages summary: ${successCount} created, ${failCount} failed`);
      
      console.log('\n🎉 Chat system setup complete!');
      console.log('\nNext steps:');
      console.log('1. Run `npm run chat:debug` to verify table structure');
      console.log('2. Run `npm run chat:listen` to start listening for real-time messages');
      console.log('3. Run `npm run chat:send` to send a new message');
      console.log('4. Run `npm run chat:edit` to edit an existing message (once UPDATE is implemented)');
      
    } else {
      console.error('❌ Failed to setup table:', tableResult.error);
    }
    
  } catch (error: any) {
    console.error('❌ Error setting up chat table:', error.message);
  }
}

setupChatTable().catch(console.error);