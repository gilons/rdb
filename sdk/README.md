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
npm install @realdb/client
```

For GraphQL subscriptions, you'll also need:

```bash
npm install @apollo/client graphql
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

### Advanced Configuration

```typescript
const client = new RdbClient({
  endpoint: 'https://your-api-gateway-endpoint.com',
  apiKey: 'your-api-key',
  // AppSync config is automatically fetched - no manual configuration needed
  disableRealtime: false, // Optional: Set to true to disable real-time features
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

### Table Management

```typescript
// Create a new table
await client.createTable({
  tableName: 'products',
  fields: [
    { name: 'name', type: 'String', required: true },
    { name: 'price', type: 'Float', required: true },
    { name: 'description', type: 'String', required: false }
  ]
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

- `table(name: string): RdbTable` - Get a table instance
- `createTable(config: TableConfig): Promise<ApiResponse>` - Create a new table
- `deleteTable(name: string): Promise<ApiResponse>` - Delete a table
- `listTables(): Promise<ApiResponse>` - List all tables
- `getTableSchema(name: string): Promise<TableSchema>` - Get table schema

### RdbTable

Represents a specific table and provides CRUD operations.

#### Methods

- `create(data: Record<string, any>): Promise<any>` - Create a record
- `get(id: string): Promise<any>` - Read a record by ID  
- `update(id: string, data: Record<string, any>): Promise<any>` - Update a record
- `delete(id: string): Promise<void>` - Delete a record
- `query(options?: QueryOptions): Promise<PaginatedResponse>` - Query records with filtering and pagination
- `onCreated(callback: Function): Subscription` - Subscribe to new record events
- `onUpdated(callback: Function): Subscription` - Subscribe to record update events  
- `onDeleted(callback: Function): Subscription` - Subscribe to record deletion events

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
cd rdb/sdk/examples/nodejs-basic

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