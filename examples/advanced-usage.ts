// examples/advanced-usage.ts

import { RdbClient } from '../src/sdk';

async function advancedExample() {
  const rdb = new RdbClient({
    apiKey: process.env.RDB_API_KEY!,
    endpoint: process.env.RDB_ENDPOINT!,
    appSyncEndpoint: process.env.APPSYNC_ENDPOINT!,
    appSyncRegion: process.env.APPSYNC_REGION || 'us-east-1',
    appSyncApiKey: process.env.APPSYNC_API_KEY!,
  });

  // Create a more complex table for a chat application
  const chatTableConfig = {
    tableName: 'messages',
    fields: [
      { name: 'messageId', type: 'String' as const, required: true, primary: true },
      { name: 'chatId', type: 'String' as const, required: true, indexed: true },
      { name: 'userId', type: 'String' as const, required: true },
      { name: 'content', type: 'String' as const, required: true },
      { name: 'messageType', type: 'String' as const }, // text, image, file
      { name: 'metadata', type: 'String' as const }, // JSON string
      { name: 'isDeleted', type: 'Boolean' as const },
    ],
    subscriptions: [
      {
        event: 'create' as const,
        filters: [
          { field: 'chatId', type: 'String' },
          { field: 'isDeleted', type: 'Boolean' },
        ],
      },
      {
        event: 'update' as const,
        filters: [{ field: 'chatId', type: 'String' }],
      },
    ],
    description: 'Real-time chat messages',
  };

  try {
    await rdb.createTable(chatTableConfig);
    console.log('Chat table created successfully');
  } catch (error) {
    console.log('Chat table setup:', error);
  }

  const messagesTable = rdb.table('messages');

  // Create a chat room subscription
  const chatSubscription = messagesTable.subscribe({
    filters: {
      chatId: 'room-general',
      isDeleted: false,
    },
    onData: (message) => {
      console.log(`[CHAT] New message in room-general:`, {
        user: message.userId,
        content: message.content,
        type: message.messageType,
        timestamp: message.createdAt,
      });
      
      // Handle different message types
      switch (message.messageType) {
        case 'text':
          console.log(`💬 ${message.userId}: ${message.content}`);
          break;
        case 'image':
          console.log(`📷 ${message.userId} shared an image`);
          break;
        case 'file':
          console.log(`📎 ${message.userId} shared a file`);
          break;
      }
    },
    onError: (error) => {
      console.error('Chat subscription error:', error);
      // Implement retry logic here
    },
  });

  // Start listening to the chat (now async to fetch schema)
  await chatSubscription.connect();
  console.log('📡 Connected to chat room: room-general');

  // Simulate multiple users sending messages
  const users = ['alice', 'bob', 'charlie', 'diana'];
  const messageTypes = ['text', 'image', 'file'];
  const sampleMessages = [
    'Hello everyone! 👋',
    'How is everyone doing?',
    'Check out this awesome feature!',
    'Anyone up for a meeting?',
    'Great work on the project! 🎉',
  ];

  // Send messages at intervals
  let messageCount = 0;
  const messageInterval = setInterval(async () => {
    if (messageCount >= 20) {
      clearInterval(messageInterval);
      return;
    }

    const user = users[Math.floor(Math.random() * users.length)];
    const messageType = messageTypes[Math.floor(Math.random() * messageTypes.length)];
    
    let content = '';
    let metadata = '';

    switch (messageType) {
      case 'text':
        content = sampleMessages[Math.floor(Math.random() * sampleMessages.length)];
        break;
      case 'image':
        content = 'image.jpg';
        metadata = JSON.stringify({ 
          size: Math.floor(Math.random() * 5000000),
          dimensions: { width: 1920, height: 1080 }
        });
        break;
      case 'file':
        content = 'document.pdf';
        metadata = JSON.stringify({ 
          size: Math.floor(Math.random() * 1000000),
          mimeType: 'application/pdf'
        });
        break;
    }

    try {
      await messagesTable.create({
        messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        chatId: 'room-general',
        userId: user,
        content,
        messageType,
        metadata,
        isDeleted: false,
      });
      messageCount++;
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }, 2000);

  // Simulate message deletion after some time
  setTimeout(async () => {
    console.log('🗑️ Demonstrating message deletion...');
    
    // Get some messages to delete
    const messages = await messagesTable.list({ limit: 5 });
    if (messages.data && messages.data.items.length > 0) {
      const messageToDelete = messages.data.items[0];
      await messagesTable.delete(messageToDelete.messageId);
      console.log(`Deleted message: ${messageToDelete.messageId}`);
    }
  }, 15000);

  // Table management operations
  setTimeout(async () => {
    console.log('📊 Demonstrating table management...');
    
    // List all tables
    const tables = await rdb.listTables();
    console.log('All tables:', tables.data?.items.map(t => t.tableName));

    // Update table (add a new field)
    try {
      await rdb.updateTable('messages', {
        fields: [
          ...chatTableConfig.fields,
          { name: 'priority', type: 'String' as const }, // high, medium, low
        ],
      });
      console.log('Table updated with priority field');
    } catch (error) {
      console.log('Table update error:', error);
    }
  }, 10000);

  // Clean up
  setTimeout(() => {
    chatSubscription.disconnect();
    clearInterval(messageInterval);
    console.log('🏁 Advanced example completed');
  }, 30000);
}

// Run the advanced example
advancedExample().catch(console.error);