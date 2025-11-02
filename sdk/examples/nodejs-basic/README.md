# RDB Real-Time Chat System Example

This example demonstrates a complete real-time chat system built with the `@realdb/client` SDK. It showcases:

- 🔥 **Real-time messaging** - See messages instantly as they arrive
- 🎯 **Smart filtering** - Listen to specific chat rooms or users
- 📨 **Live updates** - No polling, no delays, just real-time
- ✏️ **Message editing** - Update messages with live notifications (coming soon)
- 🏗️ **Type-safe** - Full TypeScript support with Zod schemas
- 🚀 **Production-ready** - Error handling and best practices included

## 🚀 Quick Start

### 1. Setup Environment

```bash
# Copy the environment template
cp .env.example .env

# Edit .env with your actual RDB API details
nano .env
```

Your `.env` file should include:
```bash
# RDB API Configuration
RDB_ENDPOINT=https://your-api-gateway-id.execute-api.region.amazonaws.com/prod
RDB_API_KEY=your-api-key-here

# Chat User Configuration
CHAT_USERNAME=Bob
CHAT_USER_ID=user1

# Optional: Filtering Configuration
FILTER_CHAT_ID=general
# FILTER_USERNAME=Alice
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Initialize the Chat System

```bash
# Create the messages table with proper schema and subscriptions
npm run chat:setup
```

This will:
- Create the `messages` table
- Set up real-time subscriptions
- Create some initial test messages
- Get everything ready for live messaging

### 4. Start Listening for Messages

Open a terminal and start the message listener:

```bash
# Listen to all messages in the general chat
npm run chat:listen

# OR listen with custom filters
FILTER_CHAT_ID=general FILTER_USERNAME=Bob npm run chat:listen:filtered
```

### 5. Send Messages

In another terminal, send messages to the chat:

```bash
# Send as default user (Bob)
npm run chat:send

# OR send as a different user
CHAT_USERNAME=Alice npm run chat:send
```

You should see real-time notifications in your listener terminal! 🎉

## 📋 Available Scripts

### Setup Script (`npm run chat:setup`)
- **File**: `src/setup-chat.ts`
- **Purpose**: Initialize the chat system
- **What it does**:
  - Creates the `messages` table
  - Configures real-time subscriptions with filters
  - Creates initial test messages
  - Gets everything ready for live chat
- **Run this first** before using other scripts

### Listen Script (`npm run chat:listen`)
- **File**: `src/chat-listen.ts`
- **Purpose**: Listen for real-time messages in the general chat
- **Features**:
  - Subscribes to new messages with `chatId` filter
  - Shows notifications for messages from other users
  - Skips own messages to avoid self-notifications
  - Prepares for UPDATE subscriptions (message edits)
  - Runs continuously until Ctrl+C

### Filtered Listen Script (`npm run chat:listen:filtered`)
- **File**: `src/chat-listen-filtered.ts`
- **Purpose**: Listen with custom filters
- **Features**:
  - Filter by chat room (`FILTER_CHAT_ID`)
  - Optionally filter by username (`FILTER_USERNAME`)
  - Demonstrates advanced subscription filtering
  - Perfect for multi-chat scenarios

### Send Script (`npm run chat:send`)
- **File**: `src/chat-send.ts`
- **Purpose**: Send a random message to the chat
- **Features**:
  - Sends to the `general` chat by default
  - Uses environment variable for username (`CHAT_USERNAME`)
  - Generates random friendly messages
  - Shows full response data
  - Triggers real-time notifications to listeners

### Edit Script (`npm run chat:edit`)
- **File**: `src/chat-edit.ts`
- **Purpose**: Preview message editing capability
- **Status**: ⏳ Coming soon
- **Shows**:
  - How to list existing messages
  - What the edit feature will look like
  - Planned functionality for updates

## 🏗️ Project Structure

```
src/
├── chat-schema.ts            # Zod schema for messages (TypeScript types)
├── setup-chat.ts             # Table creation and initialization
├── chat-listen.ts            # Real-time listener (general chat)
├── chat-listen-filtered.ts   # Real-time listener with custom filters
├── chat-send.ts              # Send messages to chat
└── chat-edit.ts              # Message editing (architecture demo)
```

## 📖 Key Concepts

### 1. Schema Definition with Zod

The chat system uses Zod for type-safe schema definition:

```typescript
import { z } from 'zod';

export const MessageSchema = z.object({
  id: z.string().optional(), // Auto-generated primary key
  chatId: z.string().min(1), // Chat room identifier
  content: z.string().min(1), // Message content
  userId: z.string().min(1), // User ID
  username: z.string().min(1), // Username (indexed for filtering)
  timestamp: z.string().optional(), // Auto-generated
  editedAt: z.string().optional(), // Edit timestamp
  isEdited: z.boolean().default(false),
});

export type Message = z.infer<typeof MessageSchema>;
```

### 2. Table Creation with Subscriptions

Create a table with real-time capabilities:

```typescript
const tableResult = await client.createTableFromSchema(
  'messages', 
  MessageSchema, 
  {
    description: 'Chat messages with real-time updates',
    indexedFields: ['chatId', 'username'], // Enable filtering
    subscriptions: [
      {
        event: 'create',
        filters: [
          { field: 'chatId', type: 'string' },   // Filter by chat room
          { field: 'username', type: 'string' }  // Filter by user
        ]
      },
      {
        event: 'update',
        filters: [
          { field: 'id', type: 'string' }  // Filter by message ID
        ]
      }
    ]
  }
);
```

### 3. Sending Messages

Create new messages with type safety:

```typescript
const messages = client.tableWithSchema('messages', MessageSchema);

const result = await messages.create({
  chatId: 'general',
  content: 'Hello everyone! 👋',
  userId: 'user1',
  username: 'Bob',
  timestamp: new Date().toISOString(),
  isEdited: false,
});
```

### 4. Real-time Subscriptions with Filters

Subscribe to messages with custom filters:

```typescript
const subscription = await messages.subscribe({
  filters: {
    chatId: 'general', // Only messages from general chat
    username: 'Alice', // Optional: only Alice's messages
  },
  onData: (message) => {
    console.log('New message:', message.content);
    console.log('From:', message.username);
  },
  onError: (error) => {
    console.error('Subscription error:', error);
  }
});

await subscription.connect();
```

### 5. Query Messages

List messages with filtering:

```typescript
const result = await messages.list({
  limit: 10,
  filters: {
    chatId: 'general'
  }
});

if (result.success) {
  result.data?.items.forEach(msg => {
    console.log(`${msg.username}: ${msg.content}`);
  });
}
```

## 🎯 Use Cases & Scenarios

### Multi-User Chat Simulation

Test the chat system by simulating multiple users:

**Terminal 1 - Alice listening:**
```bash
CHAT_USERNAME=Alice npm run chat:listen
```

**Terminal 2 - Bob sending:**
```bash
CHAT_USERNAME=Bob npm run chat:send
```

Alice will see Bob's messages in real-time! 🎉

### Multiple Chat Rooms

Create and listen to different chat rooms:

**Terminal 1 - General chat:**
```bash
FILTER_CHAT_ID=general npm run chat:listen:filtered
```

**Terminal 2 - Dev team chat:**
```bash
FILTER_CHAT_ID=dev-team npm run chat:listen:filtered
```

**Terminal 3 - Send to specific room:**
```bash
# Modify chat-send.ts to change the chatId
npm run chat:send
```

### Username Filtering

Listen only to messages from a specific user:

```bash
FILTER_CHAT_ID=general FILTER_USERNAME=Bob npm run chat:listen:filtered
```

Now you'll only see messages from Bob, even if Alice and others are chatting!

## 🔧 Advanced Features

### Smart Filtering

Listen to exactly what you need:

- **By chat room**: Only get messages from specific channels
- **By username**: Track messages from particular users
- **Combined filters**: Chat room AND username together

```typescript
// Listen to Bob's messages in the general chat only
const subscription = await messages.subscribe({
  filters: {
    chatId: 'general',
    username: 'Bob'
  },
  onData: (message) => console.log('New message:', message)
});
```

### Automatic Timestamps

Messages track their lifecycle automatically:
- `createdAt`: When the message was first created
- `updatedAt`: Last modification time
- `timestamp`: Custom application timestamp

### Multiple Subscriptions

Run multiple listeners simultaneously:

```typescript
// Listen to general chat
const generalSub = await messages.subscribe({ 
  filters: { chatId: 'general' } 
});

// Listen to dev team chat
const devSub = await messages.subscribe({ 
  filters: { chatId: 'dev-team' } 
});

// // Both run at the same time!
```

## 🏗️ How It Works

### Real-time Flow

```
┌─────────────┐                                    ┌─────────────┐
│  chat-send  │───── Send Message ────────────────▶│  RDB Cloud  │
│             │                                    │             │
└─────────────┘                                    └─────────────┘
                                                          │
                                                   Instant Push
                                                          │
                                                          ▼
                                           ┌─────────────────────────┐
                                           │     chat-listen         │
                                           │  (receives instantly!)  │
                                           └─────────────────────────┘
```

1. **Send**: You create a message with `messages.create()`
2. **Store**: RDB saves it and triggers subscriptions
3. **Push**: Active listeners receive instant notifications
4. **Filter**: Only matching subscriptions get notified

### Quick Setup

When you run `npm run chat:setup`:

1. ✅ Table is created
2. ✅ Real-time subscriptions configured
3. ✅ Test messages added
4. ⏳ Wait ~45 seconds for everything to be ready
5. 🚀 Start chatting!

## 🏃‍♂️ Complete Walkthrough
```

## �️ Architecture Overview

## 🏃‍♂️ Complete Walkthrough

### Step-by-Step Tutorial

**1. Initialize the system**
```bash
npm run chat:setup
```
✅ Messages table created successfully!
⏳ Waiting for schema propagation...
💬 Creating initial test messages...
🎉 Chat system setup complete!

**2. Start a listener in one terminal**
```bash
npm run chat:listen
```
📡 Listening for messages in #general...
👤 Listening as: Alice
✅ Listening for new messages!

**3. Send a message from another terminal**
```bash
CHAT_USERNAME=Bob npm run chat:send
```
✅ Message sent successfully!
💬 Content: Hey everyone! How's the project going? 🚀
👤 From: Bob

**4. See the real-time notification in Terminal 2**
```
🆕 New message received:
   📅 Timestamp: 2025-11-02T10:16:11.116Z
   👤 From: Bob
   💬 Message: Hey everyone! How's the project going? 🚀
   🏷️ Chat: general
```

**5. Test filtered listening**
```bash
# Only see messages from Bob
FILTER_USERNAME=Bob npm run chat:listen:filtered
```

## 🎯 What You'll Learn

1. **Real-time Subscriptions**: Instant message delivery using WebSockets
2. **Advanced Filtering**: Listen to specific chat rooms and users
3. **Schema Design**: Type-safe schemas with Zod and TypeScript
4. **Smart Queries**: Efficient filtering and data retrieval
5. **Type Safety**: Full end-to-end TypeScript support
6. **Production Patterns**: Error handling, retries, and graceful cleanup

## 🛠️ Troubleshooting

### Common Issues

**Subscription not receiving messages**
```
✅ Listening for new messages!
(No notifications appearing...)
```
**Solutions:**
- Verify the username in listener doesn't match the sender (own messages are skipped)
- Check the `chatId` filter matches the messages being sent
- Ensure `npm run chat:setup` completed successfully
- Wait 45 seconds after setup for schema propagation

**Setup taking too long**
```
❌ Failed to create message (1/3): Error...
```
**Solutions:**
- The system retries automatically (3 attempts with 10s delays)
- If all retries fail, wait a bit longer and run setup again
- The first setup can take up to 45 seconds
- Subsequent operations are instant

**Messages not filtering correctly**
```
🆕 New message received from wrong chat/user
```
**Solutions:**
- Ensure you're using `chat:listen:filtered` for custom filters
- Check environment variables are set correctly
- Verify filters in subscription match your criteria
- Remember: `chat:listen` only filters by `chatId=general`

**Solutions:**
- Set `CHAT_USERNAME=Bob` explicitly when sending
- Check `.env` file for typos
- Use same username spelling consistently

### Debug Tips

**Check current messages:**
```bash
# List all messages in the table (will need to add debug script)
npm run chat:debug
```

**Test the connection:**
Try sending a message to yourself first to verify the setup works before adding filters.

**Monitor WebSocket connection:**
The listener shows connection status:
```
📡 Connecting to subscription...
✅ Listening for new messages!
```

If you don't see the ✅, there's a connection issue.

## 📚 Next Steps & Enhancements

### Implement Message Updates

Message editing is coming soon! The SDK will support:

1. ✏️ Update existing messages
2. 🔔 Real-time edit notifications
3. 📝 Edit history tracking
4. 🎯 Subscribe to specific message updates

See `src/chat-edit.ts` for the planned API.

### Add More Features

**User presence:**
- Create a `users` table with `online` status
- Subscribe to user status changes
- Show "Alice is typing..." indicators

**Message reactions:**
- Add `reactions` field (array of emoji)
- Update messages with reactions
- Subscribe to reaction updates

**Direct messages:**
- Use `chatId` as combination: `dm_user1_user2`
- Filter subscriptions by DM chat IDs
- Implement read receipts

**Message history:**
- Implement pagination with `nextToken`
- Load older messages on scroll
- Cache messages locally

### Production Considerations

1. **Authentication**: Add user authentication and authorization
2. **Rate Limiting**: Implement request throttling
3. **Message Validation**: Sanitize content, prevent XSS attacks
4. **File Uploads**: Add support for images and attachments
5. **Analytics**: Track message metrics and user activity
6. **Monitoring**: Set up alerts for errors and performance issues

## 🎓 Key Takeaways

✅ **Real-time subscriptions** work out of the box with RDB  
✅ **Advanced filtering** enables scalable multi-chat systems  
✅ **Schema-based design** provides type safety and clear contracts  
✅ **Indexed fields** make filtering performant at scale  
✅ **WebSocket management** is handled automatically by the SDK  

## 🤝 Contributing

Found an issue or want to improve the examples? Please check the main SDK repository for contribution guidelines.

## 📖 Additional Resources

- [RDB Client SDK Documentation](../../README.md)
- [Zod Schema Validation](https://zod.dev/)
- [TypeScript Best Practices](https://www.typescriptlang.org/docs/)
- [Real-time Web Applications](https://web.dev/articles/websockets-basics)

---

**Happy real-time coding with RDB!** 🚀💬