# RDB - Real-time Database SDK

🚀 **AWS-backed real-time database with GraphQL subscriptions powered by AppSync**

Build modern applications with real-time data synchronization, scalable infrastructure, and a developer-friendly SDK.

## Features

- 🚀 **Real-time subscriptions** - Subscribe to data changes with WebSocket connections
- 🔧 **Dynamic table creation** - Create and modify tables programmatically
- 🔒 **Secure API key management** - Encrypted key storage with AWS Secrets Manager
- 📊 **CRUD operations** - Full Create, Read, Update, Delete support
- 🌐 **Multi-platform** - Works in Node.js and browsers
- ⚡ **GraphQL powered** - Built on AWS AppSync for real-time capabilities
- 🏗️ **Infrastructure as Code** - Complete AWS CDK setup included

## Architecture

RDB uses a modern serverless architecture on AWS:

- **DynamoDB** - Scalable NoSQL database for data storage
- **AppSync** - GraphQL API with real-time subscriptions
- **API Gateway** - RESTful API with Lambda authorizer
- **Lambda Functions** - Serverless compute for business logic
- **S3** - Configuration storage for schema management
- **Secrets Manager** - Secure API key storage
- **CloudWatch** - Monitoring and event handling

## Quick Start

### 1. Deploy Infrastructure

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Deploy AWS infrastructure
npm run cdk deploy
```

### 2. Create API Key

```typescript
import { createApiKey } from './src/sdk';

const { apiKey, apiKeyId } = await createApiKey(
  'https://your-api-endpoint.amazonaws.com',
  'MyApp',
  'API key for my application'
);

console.log('Your API Key:', apiKey);
```

### 3. Initialize Client

```typescript
import { RdbClient } from './src/sdk';

const rdb = new RdbClient({
  apiKey: 'rdb_your_api_key_here',
  endpoint: 'https://your-api-endpoint.amazonaws.com',
  appSyncEndpoint: 'https://your-appsync-endpoint.amazonaws.com/graphql',
  region: 'us-east-1'
});
```

### 4. Create a Table

```typescript
await rdb.createTable({
  tableName: 'users',
  fields: [
    { name: 'id', type: 'String', required: true, primary: true },
    { name: 'email', type: 'String', required: true, indexed: true },
    { name: 'name', type: 'String', required: true },
    { name: 'age', type: 'Int' },
    { name: 'active', type: 'Boolean' }
  ],
  subscriptions: [
    { event: 'create', filters: [{ field: 'active', operator: 'eq', value: true }] },
    { event: 'update' }
  ],
  description: 'User management table'
});
```

### 5. Perform CRUD Operations

```typescript
const usersTable = rdb.table('users');

// Create a record
await usersTable.create({
  id: 'user1',
  email: 'john@example.com',
  name: 'John Doe',
  age: 30,
  active: true
});

// List records
const users = await usersTable.list({ limit: 10 });

// Delete a record
await usersTable.delete('user1');
```

### 6. Subscribe to Real-time Updates

```typescript
const subscription = usersTable.subscribe({
  filters: { active: true },
  onData: (data) => {
    console.log('Real-time update:', data);
  },
  onError: (error) => {
    console.error('Subscription error:', error);
  }
});

// Start listening
subscription.connect();

// Disconnect when done
subscription.disconnect();
```

## Development

### Commands

```bash
npm run build        # Compile TypeScript
npm run watch        # Watch mode compilation
npm run test         # Run tests
npm run cdk deploy   # Deploy infrastructure
npm run cdk destroy  # Remove infrastructure
```

## Examples

Check `examples/usage-examples.ts` for comprehensive usage examples.

---

**Built with ❤️ using AWS CDK, TypeScript, and modern serverless technologies.**our CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
