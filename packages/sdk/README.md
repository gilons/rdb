# RDB Client SDK

A TypeScript SDK for interacting with AWS-backed real-time databases. This SDK provides both HTTP operations and real-time GraphQL subscriptions powered by AWS AppSync.

## Features

- ✅ **Type-safe operations** - Full TypeScript support with generated types
- ✅ **Real-time subscriptions** - GraphQL subscriptions via AWS AppSync  
- ✅ **Dynamic schema** - Support for flexible table schemas
- ✅ **Built-in caching** - Apollo Client integration for efficient data fetching
- ✅ **Error handling** - Comprehensive error handling and retry logic
- ✅ **Dual module support** - Works with both CommonJS and ES modules

## Installation

```bash
npm install @realdb/client zod
```

**Note**: Zod is required for schema validation and type safety.

For GraphQL subscriptions (real-time features), you'll also need:

```bash
npm install @apollo/client graphql ws
```

## Quick Start

### Basic Setup

```typescript
import { RdbClient } from '@realdb/client';

// Initialize with your API endpoint
const client = new RdbClient({
  endpoint: 'https://your-api.example.com',
  apiKey: 'your-api-key',
});
```

### Advanced Configuration

```typescript
const client = new RdbClient({
  endpoint: 'https://your-api-gateway-endpoint.com',
  apiKey: 'your-api-key',
  // Optional: API route prefix (if your RDB API is mounted under a prefix)
  apiPrefix: 'v1', // or 'rdb', 'api/v1', etc.
  // AppSync config is automatically fetched - no manual configuration needed
  disableRealtime: false, // Optional: Set to true to disable real-time features
});
```

## Complete Example: Chat Application

Here's a complete example showing table creation, CRUD operations, and real-time subscriptions:

```typescript
import { RdbClient } from '@realdb/client';
import { z } from 'zod';

// 1. Define your schema with Zod
const MessageSchema = z.object({
  id: z.string().optional(),        // Auto-generated
  chatId: z.string().min(1),
  content: z.string().min(1),
  userId: z.string(),
  username: z.string(),
  timestamp: z.string().optional(),  // Auto-generated
  isEdited: z.boolean().default(false),
});

type Message = z.infer<typeof MessageSchema>;

// 2. Initialize client
const client = new RdbClient({
  endpoint: process.env.RDB_ENDPOINT!,
  apiKey: process.env.RDB_API_KEY!,
});

// 3. Create table from schema
await client.createTableFromSchema('messages', MessageSchema, {
  description: 'Chat messages with real-time updates',
  indexedFields: ['chatId', 'username'], // Enable filtering by these fields
  subscriptions: [
    {
      filters: [
        { field: 'chatId', type: 'string' },
        { field: 'username', type: 'string' },
      ]
    }
  ]
});

// 4. Get typed table instance
const messages = client.tableWithSchema('messages', MessageSchema);

// 5. Create messages (type-safe!)
const result = await messages.create({
  chatId: 'general',
  content: 'Hello, World!',
  userId: 'user1',
  username: 'Alice',
});

if (result.success) {
  console.log('Message created:', result.data);
  // result.data is typed as Message
}

// 6. List messages
const allMessages = await messages.list({ limit: 50 });
if (allMessages.success) {
  allMessages.data?.items.forEach(msg => {
    console.log(`${msg.username}: ${msg.content}`);
    // msg is typed as Message
  });
}

// 7. Subscribe to real-time updates
const subscription = messages.subscribe({
  filters: { chatId: 'general' }, // Only messages from 'general' chat
  onData: (message) => {
    console.log('New message:', message);
    // message is typed as Message
  },
  onError: (error) => {
    console.error('Subscription error:', error);
  }
});

// Start listening
subscription.connect();

// Clean up when done
process.on('SIGINT', () => {
  subscription.disconnect();
  process.exit();
});
```

**API Prefix Usage:**

If your RDB infrastructure was deployed with a custom `apiPrefix`, you must include it in the SDK configuration:

```typescript
// If RDB was deployed with apiPrefix: 'rdb'
// API routes will be: /rdb/tables, /rdb/tables/{name}/records, etc.
const client = new RdbClient({
  endpoint: 'https://api.example.com',
  apiKey: 'your-key',
  apiPrefix: 'rdb'
});
```

### Table Operations

```typescript
// Get a table instance
const usersTable = client.table('users');

// Create a record
const newUser = await usersTable.create({
  name: 'John Doe',
  email: 'john@example.com',
  age: 30
});

// Read records with pagination
const users = await usersTable.query({
  limit: 10,
  sort: { field: 'createdAt', direction: 'DESC' }
});

// Update a record
const updatedUser = await usersTable.update('user-id', {
  age: 31
});

// Delete a record
await usersTable.delete('user-id');
```

### Real-time Subscriptions

```typescript
// Subscribe to new records (AppSync configuration is automatic)
const createSubscription = usersTable.onCreated((newUser) => {
  console.log('New user created:', newUser);
});

// Subscribe to updates
const updateSubscription = usersTable.onUpdated((updatedUser) => {
  console.log('User updated:', updatedUser);
});

// Subscribe to deletions
const deleteSubscription = usersTable.onDeleted((deletedUser) => {
  console.log('User deleted:', deletedUser);
});

// Clean up subscriptions
createSubscription.unsubscribe();
updateSubscription.unsubscribe();
deleteSubscription.unsubscribe();
```

### Table Management with Zod Schemas

```typescript
import { z } from 'zod';

// Define schema with Zod for type safety and validation
const ProductSchema = z.object({
  id: z.string().optional(), // Auto-generated
  name: z.string().min(1),
  price: z.number().positive(),
  description: z.string().optional(),
  inStock: z.boolean().default(true),
  createdAt: z.string().optional()
});

type Product = z.infer<typeof ProductSchema>;

// Create a new table from Zod schema
await client.createTableFromSchema('products', ProductSchema, {
  description: 'Product catalog',
  indexedFields: ['name', 'inStock'], // Fields to index for queries
  subscriptions: [
    {
      filters: [
        { field: 'inStock', type: 'boolean' },
        { field: 'name', type: 'string' }
      ]
    }
  ]
});

// Get typed table instance
const products = client.tableWithSchema('products', ProductSchema);

// Now all operations are type-safe!
const result = await products.create({
  name: 'Widget',
  price: 29.99,
  description: 'A great widget',
  inStock: true
});

// List all tables
const tables = await client.listTables();

// Get table schema
const schema = await client.getTableSchema('products');

// Delete a table
await client.deleteTable('products');
```

## API Reference

### RdbClient

The main client class for interacting with the RDB service.

#### Constructor Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `endpoint` | string | ✅ | Your API Gateway endpoint URL |
| `apiKey` | string | ✅ | Your API key for authentication |
| `disableRealtime` | boolean | ❌ | Disable real-time subscriptions (defaults to false) |

> **Note**: AppSync configuration for real-time subscriptions is automatically fetched from your API endpoint. You no longer need to provide AppSync credentials manually.

#### Methods

**Table Management:**
- `createTableFromSchema<T>(tableName: string, schema: z.ZodSchema<T>, options?: TableOptions): Promise<ApiResponse>` - Create a table from Zod schema with type safety
- `tableWithSchema<T>(tableName: string, schema: z.ZodSchema<T>): TypedRdbTable<T>` - Get a typed table instance with schema validation
- `table(name: string): RdbTable` - Get an untyped table instance (legacy)
- `deleteTable(name: string): Promise<ApiResponse>` - Delete a table
- `listTables(): Promise<ApiResponse>` - List all tables
- `getTableSchema(name: string): Promise<TableSchema>` - Get table schema

**TableOptions:**
```typescript
interface TableOptions {
  description?: string;
  indexedFields?: string[]; // Fields to index for efficient queries
  subscriptions?: Array<{
    filters?: Array<{
      field: string;
      type: 'string' | 'number' | 'boolean';
    }>;
  }>;
}
```

### TypedRdbTable<T>

Represents a typed table with Zod schema validation. All operations are type-safe and validated against your schema.

#### Methods

- `create(data: Partial<T>): Promise<ApiResponse<T>>` - Create a record with validation
- `get(id: string): Promise<ApiResponse<T>>` - Read a record by ID  
- `update(id: string, data: Partial<T>): Promise<ApiResponse<T>>` - Update a record with validation
- `delete(id: string): Promise<ApiResponse>` - Delete a record
- `list(options?: QueryOptions): Promise<ApiResponse<{ items: T[] }>>` - List records with pagination
- `subscribe(options: SubscriptionOptions): Subscription` - Subscribe to real-time updates

**SubscriptionOptions:**
```typescript
interface SubscriptionOptions {
  filters?: Record<string, any>; // Filter by indexed fields
  onData: (data: T) => void;     // Type-safe callback
  onError?: (error: Error) => void;
}
```

### RdbTable (Legacy)

Untyped table instance - prefer using `tableWithSchema` for type safety.

#### Methods

- `create(data: Record<string, any>): Promise<any>` - Create a record
- `get(id: string): Promise<any>` - Read a record by ID  
- `update(id: string, data: Record<string, any>): Promise<any>` - Update a record
- `delete(id: string): Promise<void>` - Delete a record
- `query(options?: QueryOptions): Promise<PaginatedResponse>` - Query records

### Error Handling

The SDK provides comprehensive error handling:

```typescript
import { RdbClient } from '@realdb/client';

try {
  const client = new RdbClient({ endpoint: 'https://api.example.com', apiKey: 'key' });
  const usersTable = client.table('users');
  await usersTable.create({ name: 'John' });
} catch (error) {
  console.error('Operation failed:', error.message);
  // The SDK wraps HTTP errors with descriptive messages
}
```

## Examples

Complete TypeScript examples are available in the `/examples/nodejs-basic/` directory:

```bash
# Clone the repository
git clone https://github.com/gilons/rdb.git
cd rdb/packages/sdk/examples/nodejs-basic

# Install dependencies
npm install

# Set up environment
cp env.example .env
# Edit .env with your API details

# Run examples
npm run dev        # Basic comprehensive demo
npm run crud       # Advanced CRUD operations
npm run realtime   # Real-time subscriptions demo
npm run setup      # Environment setup and validation
```

The examples demonstrate:
- ✅ **Table Management** - Creating and managing table schemas
- ✅ **CRUD Operations** - Complete create, read, update, delete workflows
- ✅ **Real-time Features** - Live WebSocket subscriptions 
- ✅ **Error Handling** - Proper error handling patterns
- ✅ **TypeScript Usage** - Full type safety and IntelliSense support

## Development

### Building from Source

```bash
git clone https://github.com/gilons/rdb.git
cd rdb/sdk
npm install
npm run build
```

### Running Tests

```bash
npm test
```

## Security & Configuration

### Automatic Configuration Fetching

For security reasons, the SDK automatically fetches AppSync configuration (endpoints, regions, and API keys) from your authenticated API. This means:

- ✅ **No exposed credentials** - AppSync details aren't exposed in client code
- ✅ **Automatic updates** - Configuration changes are automatically picked up
- ✅ **Intelligent caching** - Configuration is cached locally with TTL for performance
- ✅ **Graceful fallback** - If real-time features fail, HTTP operations continue working

### Configuration Caching

The SDK caches AppSync configuration for 1 hour by default. If you need to force a refresh:

```typescript
// Disable real-time temporarily to force config refresh on next use
client.config.disableRealtime = true;
// Re-enable to fetch fresh config
client.config.disableRealtime = false;
```

### Network Requirements

The SDK makes the following network calls:
- **HTTP API calls** - Direct to your API Gateway endpoint
- **Config fetch** - `GET /sdk/config` to fetch real-time configuration  
- **Real-time subscriptions** - WebSocket connections to AWS AppSync

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
- 🐛 [Report bugs](https://github.com/gilons/rdb/issues)
- 💬 [Discussions](https://github.com/gilons/rdb/discussions)
- 📧 [Email support](mailto:giles.fokam@example.com)