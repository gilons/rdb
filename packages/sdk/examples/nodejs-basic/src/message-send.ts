import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';
import { MessageSchema, ChatTableNames } from './chat-schema';

// Load environment variables
config();

async function sendMessage(): Promise<void> {
  console.log('💬 Sending a new chat message\n');

  const client = new RdbClient({
    endpoint: process.env.RDB_ENDPOINT!,
    apiKey: process.env.RDB_API_KEY!,
  });

  const messages = client.tableWithSchema(ChatTableNames.messages, MessageSchema);

  // Generate random message content
  const messageContent = [
    'Hey everyone! How\'s the project going? 🚀',
    'Just deployed the new feature, please test it out! ✨',
    'Coffee break anyone? ☕',
    'Great work on the presentation today! 👏',
    'Don\'t forget about the team meeting at 3 PM 📅',
    'The real-time updates are working perfectly! 🎉',
    'This chat system is pretty cool, right? 😎'
  ];

  const randomMessage = messageContent[Math.floor(Math.random() * messageContent.length)];
  const timestamp = new Date().toISOString();
  
  // Get current user (can be set via environment variable)
  const currentUser = process.env.CHAT_USERNAME || 'Bob';
  const userId = process.env.CHAT_USER_ID || 'user1';

  console.log('📝 Sending message...');
  console.log(`👤 Sending as: ${currentUser}`);
  
  const result = await messages.create({
    chatId: 'general',
    content: randomMessage,
    userId: userId,
    username: currentUser,
    timestamp: timestamp,
    isEdited: false,
  });

  if (result.success) {
    console.log('✅ Message sent successfully!');
    console.log('   Check the listener terminal - you should see a real-time notification!\n');
    console.log('   Message details:');
    console.log('   🆔 ID:', result.data?.id || (result.data as any)?.name || 'No ID returned');
    console.log('   💬 Content:', randomMessage);
    console.log('   🏷️ Chat: general');
    console.log('   📅 Sent at:', timestamp);
    console.log('   👤 From:', result.data?.username);
    console.log('\n📋 Full response data:');
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.error('❌ Failed to send message:', result.error);
  }
}

sendMessage().catch(console.error);