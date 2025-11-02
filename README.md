# RDB - Real-time Da### [@realdb/sdk](./sdk)
TypeScript SDK for interacting with RDB

```bash
npm install @realdb/sdk zod
```

## ✨ Features

- 🚀 **Real-time Subscriptions** - WebSocket connections for instant data updates via AWS AppSync
- 🔧 **Dynamic Schema** - Create and modify tables programmatically with Zod validation
- 🔒 **Secure by Default** - API key authentication with AWS Secrets Manager encryption
- 📊 **Full CRUD Operations** - Complete Create, Read, Update, Delete support
- 🌐 **Multi-platform** - Works in Node.js and browsers
- ⚡ **Serverless** - Auto-scaling infrastructure with pay-per-use pricing
- 🏗️ **Infrastructure as Code** - Deploy with AWS CDK
- 🎯 **Type-Safe** - Full TypeScript support with Zod schema validation-backed serverless real-time database with GraphQL subscriptions**

A complete serverless database solution built on AWS infrastructure, featuring real-time data synchronization, dynamic schema management, and a developer-friendly SDK.

[![npm version](https://badge.fury.io/js/@realdb%2Fclient.svg)](https://www.npmjs.com/package/@realdb/sdk)
[![npm version](https://badge.fury.io/js/@realdb%2Fcdk.svg)](https://www.npmjs.com/package/@realdb/cdk)

## 📦 Packages

This monorepo contains two published packages:

### [@realdb/cdk](./packages/cdk)
AWS CDK construct for deploying RDB infrastructure

```bash
npm install @realdb/cdk
```

### [@realdb/sdk](./packages/sdk)
TypeScript SDK for interacting with RDB

```bash
npm install @realdb/sdk
```

## ✨ Features

- 🚀 **Real-time Subscriptions** - WebSocket connections for instant data updates via AWS AppSync
- 🔧 **Dynamic Schema** - Create and modify tables programmatically without migrations
- 🔒 **Secure by Default** - API key authentication with AWS Secrets Manager encryption
- 🌐 **Multi-platform** - Works in Node.js and browsers
- ⚡ **Serverless** - Auto-scaling infrastructure with pay-per-use pricing
- 🏗️ **Infrastructure as Code** - Deploy with AWS CDK
- 🎯 **Type-Safe** - Full TypeScript support

## 🏗️ Architecture

RDB uses a modern serverless architecture on AWS:

| Service | Purpose |
|---------|---------|
| **DynamoDB** | Metadata and data storage |
| **AppSync** | GraphQL API with real-time subscriptions |
| **API Gateway** | RESTful API with Lambda authorizer |
| **Lambda** | Serverless compute for business logic |
| **S3** | Schema configuration storage |
| **SQS** | Asynchronous task queue with DLQ |
| **Secrets Manager** | Encrypted API key storage |
| **EventBridge** | Automated schema synchronization |
| **CloudWatch** | Logging and monitoring |

## 🚀 Quick Start

### 1. Deploy Infrastructure

```typescript
import * as cdk from 'aws-cdk-lib';
import { RdbConstruct } from '@realdb/cdk';

const app = new cdk.App();
const stack = new cdk.Stack(app, 'RdbStack');

new RdbConstruct(stack, 'Rdb', {
  resourceSuffix: 'prod',  // Optional: suffix for resource names
  apiPrefix: 'v1',         // Optional: API route prefix
});
```

Deploy:
```bash
npm install @realdb/cdk aws-cdk-lib constructs
npm run cdk deploy
```

### 2. Initialize Client

```typescript
import { RdbClient } from '@realdb/sdk';

const rdb = new RdbClient({
  endpoint: 'https://your-api-gateway.amazonaws.com',
  apiKey: 'your-api-key',
  apiPrefix: 'v1',  // Optional: must match CDK deployment
});
```

### 3. Define Your Schema with Zod

```typescript
import { z } from 'zod';

// Define your schema using Zod
const UserSchema = z.object({
  id: z.string().optional(), // Auto-generated if not provided
  email: z.string().email(),
  name: z.string().min(1),
  age: z.number().int().positive().optional(),
  active: z.boolean().default(true),
  createdAt: z.string().optional(), // Auto-generated timestamp
});

type User = z.infer<typeof UserSchema>;
```

### 4. Create a Table from Schema

```typescript
// Create table with Zod schema validation
await rdb.createTableFromSchema('users', UserSchema, {
  description: 'User management table',
  indexedFields: ['email'], // Fields to index for efficient queries
  subscriptions: [
    {
      filters: [
        { field: 'active', type: 'boolean' },
        { field: 'email', type: 'string' }
      ]
    }
  ]
});
```

### 5. Perform Type-Safe CRUD Operations

```typescript
// Get a typed table instance
const usersTable = rdb.tableWithSchema('users', UserSchema);

// Create - with full type safety and validation
const createResult = await usersTable.create({
  email: 'john@example.com',
  name: 'John Doe',
  age: 30,
  active: true
});

if (createResult.success) {
  console.log('User created:', createResult.data);
  // createResult.data is fully typed as User
}

// Read
const singleUser = await usersTable.get(createResult.data.id);
const allUsers = await usersTable.list({ limit: 100 });

// Update - validated against schema
await usersTable.update(createResult.data.id, { age: 31 });

// Delete
await usersTable.delete(createResult.data.id);
```

### 6. Subscribe to Real-time Updates

```typescript
const subscription = usersTable.subscribe({
  filters: { active: true }, // Filter by indexed fields
  onData: (data) => {
    console.log('Real-time update:', data);
    // data is fully typed as User
  },
  onError: (error) => {
    console.error('Subscription error:', error);
  }
});

// Start listening
subscription.connect();

// Clean up when done
subscription.disconnect();
```

### 5. Subscribe to Real-time Updates

```typescript
const subscription = usersTable.subscribe({
  event: 'create',
  filters: { active: true },
  onData: (data) => {
    console.log('New user created:', data);
  },
  onError: (error) => {
    console.error('Subscription error:', error);
  }
});

// Start listening
subscription.connect();

// Clean up when done
subscription.disconnect();
```

## 📚 Documentation

### CDK Construct
See [packages/cdk/README.md](./packages/cdk/README.md) for:
- Advanced configuration options
- Custom resource naming
- API prefix setup
- Multi-environment deployments
- Security best practices

### Client SDK
See [sdk/README.md](./sdk/README.md) for:
- Complete API reference
- Real-time subscriptions
- Error handling
- Type definitions
- Advanced usage patterns

### Examples
Check out [packages/sdk/examples/nodejs-basic](.packages/sdk/examples/nodejs-basic) for working examples:
- Chat application
- Real-time messaging
- CRUD operations
- Subscription handling

## 🔧 Development

### Repository Structure

```
rdb/
├── packages/
│   └── cdk/          # CDK construct package
│       ├── src/          # Construct implementation
│       ├── lambdas/      # Lambda function code
│       └── schema/       # GraphQL schema
├── sdk/                  # Client SDK package
│   ├── src/              # SDK implementation
│   └── examples/         # Usage examples
├── lib/                  # CDK stack definitions
├── bin/                  # CDK app entry point
└── test/                 # Tests
```

### Commands

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm run test

# Deploy infrastructure
npm run cdk deploy

# Watch for changes
npm run watch

# Clean up AWS resources
npm run cdk destroy
```

### Publishing Packages

```bash
# Publish CDK construct
cd packages/cdk
npm run build
npm publish

# Publish SDK
cd sdk
npm run build
npm publish
```

## 🔑 API Key Management

### Creating API Keys

API keys are created through the deployed API Gateway endpoint:

```bash
curl -X POST https://your-api-gateway.amazonaws.com/v1/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "description": "API key for my application"
  }'
```

Response:
```json
{
  "apiKeyId": "uuid-here",
  "apiKey": "rdb_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "name": "my-app",
  "createdAt": "2025-11-02T12:00:00.000Z"
}
```

⚠️ **Important**: Save the `apiKey` value - it cannot be retrieved later!

## 🛡️ Security

- API keys are encrypted at rest using AWS Secrets Manager
- All Lambda functions have least-privilege IAM roles
- API Gateway uses Lambda authorizer for request validation
- AppSync uses API key authentication for subscriptions
- DynamoDB tables support encryption at rest
- S3 bucket has versioning enabled for schema rollback

## 💰 Cost Considerations

RDB uses serverless pay-per-use pricing. Approximate costs:

- **DynamoDB**: $0.25 per million read/write requests + storage
- **API Gateway**: $3.50 per million requests
- **Lambda**: $0.20 per million requests + compute time
- **AppSync**: $4.00 per million requests + real-time updates
- **S3**: $0.023 per GB storage + requests
- **Secrets Manager**: $0.40 per secret per month

**Example**: 1M requests/month ≈ $5-10/month for typical usage

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details

## 🔗 Links

- [npm: @realdb/sdk](https://www.npmjs.com/package/@realdb/sdk)
- [npm: @realdb/cdk](https://www.npmjs.com/package/@realdb/cdk)
- [GitHub Repository](https://github.com/gilons/rdb)
- [Issues](https://github.com/gilons/rdb/issues)

## 📞 Support

For questions, issues, or feature requests:
- Open an [issue](https://github.com/gilons/rdb/issues)
- Email: gf.694765457@gmail.com

---

**Built with ❤️ using AWS CDK, TypeScript, and modern serverless technologies**
