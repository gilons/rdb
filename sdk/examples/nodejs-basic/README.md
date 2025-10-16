# RDB Node.js TypeScript Example

This example demonstrates how to use the `@realdb/client` SDK in a Node.js TypeScript application. It showcases all major features including table management, CRUD operations, and real-time subscriptions.

## 🚀 Quick Start

### 1. Setup Environment

```bash
# Copy the environment template
cp env.example .env

# Edit .env with your actual RDB API details
nano .env
```

Your `.env` file should look like:
```bash
RDB_ENDPOINT=https://your-api-gateway-id.execute-api.region.amazonaws.com/prod
RDB_API_KEY=your-api-key-here
```

### 2. Install Dependencies

```bash
# Install all dependencies
npm install
```

### 3. Run Examples

```bash
# Run the basic comprehensive demo
npm run dev

# Run specific demos
npm run crud        # CRUD operations demo
npm run realtime    # Real-time subscriptions demo

# Build and run production version
npm run build
npm start
```

## 📋 Available Demos

### Basic Demo (`npm run dev`)
- **File**: `src/index.ts`
- **Features**: Complete overview with table creation, basic CRUD, and real-time setup
- **Best for**: Getting started and understanding the SDK structure

### CRUD Demo (`npm run crud`)
- **File**: `src/crud-demo.ts` 
- **Features**: Comprehensive CRUD operations with advanced querying
- **Includes**:
  - Individual and batch create operations
  - Advanced filtering and search
  - Pagination and sorting
  - Update and delete operations
  - Count and statistics

### Real-time Demo (`npm run realtime`)
- **File**: `src/realtime-demo.ts`
- **Features**: Live real-time subscriptions demonstration  
- **Includes**:
  - WebSocket connection management
  - Create, update, and delete event subscriptions
  - Simulated chat activity
  - Graceful cleanup

## 🏗️ Code Structure

```
src/
├── index.ts          # Main comprehensive demo
├── crud-demo.ts      # Detailed CRUD operations
├── realtime-demo.ts  # Real-time subscriptions
└── types.ts          # TypeScript interfaces (optional)
```

## 📖 Key Concepts

### Client Initialization
```typescript
import { RdbClient } from '@rdb/client';

const client = new RdbClient({
  endpoint: process.env.RDB_ENDPOINT,
  apiKey: process.env.RDB_API_KEY,
});
```

The SDK automatically:
- Fetches AppSync configuration from your API
- Establishes WebSocket connections for real-time features
- Handles authentication and authorization
- Provides TypeScript type safety

### Table Management
```typescript
// Create a table
await client.createTable({
  tableName: 'users',
  fields: [
    { name: 'name', type: 'String', required: true },
    { name: 'email', type: 'String', required: true, indexed: true },
    { name: 'age', type: 'Int', required: false }
  ]
});

// Get table instance
const users = client.table('users');
```

### CRUD Operations
```typescript
// Create
const user = await users.create({
  name: 'John Doe',
  email: 'john@example.com',
  age: 30
});

// Read
const allUsers = await users.query({ limit: 10 });
const specificUser = await users.get(user.id);

// Update  
const updated = await users.update(user.id, { age: 31 });

// Delete
await users.delete(user.id);
```

### Real-time Subscriptions
```typescript
// Subscribe to new records
const subscription = users.onCreated((newUser) => {
  console.log('New user:', newUser);
});

// Subscribe to updates
users.onUpdated((updatedUser) => {
  console.log('User updated:', updatedUser);
});

// Clean up
subscription.unsubscribe();
```

## 🔧 Advanced Features

### Filtering and Queries
```typescript
// Filter by field
const results = await users.query({
  filters: { age: 25, active: true },
  limit: 10
});

// Text search
const searchResults = await users.query({
  search: 'john',
  limit: 5
});

// Sorting
const sorted = await users.query({
  orderBy: 'name',
  orderDirection: 'asc'
});
```

### Batch Operations
```typescript
// Batch create
const newUsers = [
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' }
];
await users.createBatch(newUsers);

// Batch update
const updates = [
  { id: 'user1', updates: { active: true } },
  { id: 'user2', updates: { active: false } }
];
await users.updateBatch(updates);
```

## 🏃‍♂️ Running the Examples

### Prerequisites
- Node.js 18+ 
- TypeScript 4.5+
- Valid RDB API endpoint and key

### Development Mode
```bash
# Run with hot reload
npm run dev

# Run specific demo
npm run crud
npm run realtime
```

### Production Build
```bash
# Build TypeScript to JavaScript
npm run build

# Run built version
npm start
```

## 🎯 What You'll Learn

1. **SDK Security**: How AppSync credentials are automatically fetched
2. **Type Safety**: Full TypeScript support with proper interfaces
3. **Real-time**: WebSocket subscriptions without manual schema management
4. **Performance**: Batch operations and efficient querying
5. **Best Practices**: Error handling, cleanup, and resource management

## 🛠️ Troubleshooting

### Common Issues

**Missing Environment Variables**
```
❌ Missing RDB_ENDPOINT environment variable
```
→ Check your `.env` file exists and contains the correct values

**Connection Errors**
```
❌ Error initializing RDB client
```
→ Verify your API endpoint URL and API key are correct

**Type Errors**
```
❌ Cannot find module '@rdb/client'
```
→ Run `npm install` to install dependencies

### Getting Help

1. Check the console output for detailed error messages
2. Ensure your RDB API is deployed and accessible
3. Verify your API key has the necessary permissions
4. Review the example code for proper usage patterns

## 📚 Next Steps

After running these examples:

1. **Integrate into your app**: Copy patterns from the examples
2. **Customize schemas**: Define your own table structures  
3. **Add error handling**: Implement proper error boundaries
4. **Scale operations**: Use batch operations for better performance
5. **Monitor real-time**: Set up proper subscription management

## 🤝 Contributing

Found an issue or want to improve the examples? Please check the main SDK repository for contribution guidelines.

---

**Happy coding with RDB!** 🚀