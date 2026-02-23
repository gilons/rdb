# @realdb/cdk

AWS CDK construct library for deploying RDB (Real-time Database) infrastructure with Zod schema validation.

[![npm version](https://badge.fury.io/js/@realdb%2Fcdk.svg)](https://www.npmjs.com/package/@realdb/cdk)

## Overview

RDB is a serverless real-time database built on AWS infrastructure. This CDK construct allows you to easily deploy the complete RDB infrastructure to your AWS account with a single construct.

### ✨ Features

- 🚀 **Serverless Architecture** - Built on AWS Lambda, DynamoDB, and AppSync
- ⚡ **Real-time Subscriptions** - WebSocket connections for instant data updates via AppSync
- 🔐 **Secure by Default** - API key authentication with AWS Secrets Manager encryption
- 📊 **Auto-Scaling** - DynamoDB on-demand billing scales with your needs
- 🛠️ **Easy to Deploy** - Single construct deploys complete infrastructure
- 🎯 **Customizable** - Support for existing APIs, custom resource names, and API prefixes
- 💰 **Cost Effective** - Serverless pay-per-use pricing model
- 🔄 **Dead Letter Queue** - Failed operations are captured for retry
- 📝 **Full Logging** - CloudWatch logs with configurable retention
- 📋 **Initial Tables** - Define tables in CDK and have them auto-created on deployment

### 🏗️ Architecture

The RDB construct deploys the following AWS resources:

| Resource | Purpose |
|----------|---------|
| **DynamoDB Tables** (2) | Metadata storage for tables (`rdb-tables`) and API keys (`rdb-api-keys`) |
| **AppSync GraphQL API** | Real-time subscriptions and GraphQL mutations |
| **API Gateway REST API** | RESTful CRUD operations with Lambda authorizer |
| **Lambda Functions** (7) | Table management, records, API keys, schema sync, decommission, auth, SDK config |
| **S3 Bucket** | Versioned schema configuration storage with EventBridge |
| **SQS Queue + DLQ** | Asynchronous table decommissioning with retry logic |
| **Secrets Manager** | Encrypted API key storage |
| **EventBridge Rule** | Automated schema synchronization from S3 changes |
| **CloudWatch Logs** | Comprehensive logging for all Lambda functions |

## 📦 Installation

```bash
npm install @realdb/cdk aws-cdk-lib constructs
```

**Peer Dependencies:**
- `aws-cdk-lib` ^2.0.0
- `constructs` ^10.0.0

## 🚀 Quick Start

### Basic Example

```typescript
import * as cdk from 'aws-cdk-lib';
import { RdbConstruct } from '@realdb/cdk';

export class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Deploy complete RDB infrastructure
    const rdb = new RdbConstruct(this, 'Rdb');

    // Output the API endpoint
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: rdb.api!.url,
      description: 'RDB API Gateway endpoint',
    });

    // Output the AppSync endpoint for real-time subscriptions
    new cdk.CfnOutput(this, 'AppSyncEndpoint', {
      value: rdb.appSyncApi.graphqlUrl,
      description: 'AppSync GraphQL endpoint',
    });
  }
}
```

### Advanced Configuration

```typescript
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import { RdbConstruct } from '@realdb/cdk';

export class ProductionStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const rdb = new RdbConstruct(this, 'Rdb', {
      // Resource naming
      resourceSuffix: 'prod',              // Creates rdb-tables-prod, rdb-api-keys-prod, etc.
      apiPrefix: 'v1',                     // API routes: /v1/tables, /v1/tables/{name}/records
      
      // Lifecycle
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Prevent accidental deletion in production
      
      // DynamoDB
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // Auto-scaling on-demand
      
      // Monitoring & Tracing
      enableXRayTracing: true,             // Enable AWS X-Ray
      logRetention: logs.RetentionDays.ONE_MONTH,
      enableApiLogging: true,
      
      // CORS
      corsOrigins: [
        'https://app.example.com',
        'https://admin.example.com'
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: rdb.api!.url,
      exportName: 'RdbApiEndpoint',
    });

    new cdk.CfnOutput(this, 'AppSyncEndpoint', {
      value: rdb.appSyncApi.graphqlUrl,
      exportName: 'RdbAppSyncEndpoint',
    });

    new cdk.CfnOutput(this, 'ConfigBucket', {
      value: rdb.configBucket.bucketName,
      exportName: 'RdbConfigBucket',
    });
  }
}
```

### Multi-Environment Setup

```typescript
import * as cdk from 'aws-cdk-lib';
import { RdbConstruct } from '@realdb/cdk';

const app = new cdk.App();

// Development environment
new cdk.Stack(app, 'RdbDevStack', {
  env: { region: 'us-east-1' }
});

const devRdb = new RdbConstruct(this, 'RdbDev', {
  resourceSuffix: 'dev',
  removalPolicy: cdk.RemovalPolicy.DESTROY, // Easy cleanup
  corsOrigins: ['*'], // Allow all for testing
});

// Production environment
const prodStack = new cdk.Stack(app, 'RdbProdStack', {
  env: { region: 'us-east-1' }
});

const prodRdb = new RdbConstruct(prodStack, 'RdbProd', {
  resourceSuffix: 'prod',
  removalPolicy: cdk.RemovalPolicy.RETAIN,  // Prevent data loss
  corsOrigins: ['https://app.example.com'],
  enableXRayTracing: true,
});
```

### Using Existing Resources

```typescript
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { RdbConstruct } from '@realdb/cdk';

// Use existing API Gateway
const existingApi = apigateway.RestApi.fromRestApiAttributes(this, 'ExistingApi', {
  restApiId: 'abc123',
  rootResourceId: 'xyz789',
});

// Use existing DynamoDB table for metadata
const existingTable = dynamodb.Table.fromTableName(this, 'ExistingTable', 'my-tables');

const rdb = new RdbConstruct(this, 'Rdb', {
  existingApi: existingApi,           // Add RDB routes to existing API
  existingTablesTable: existingTable, // Use existing metadata table
  apiPrefix: 'rdb',                   // Mount under /rdb/* routes
});
```

### 📋 Initial Tables (Recommended)

The best way to use RDB is to define your tables directly in CDK using `initialTables`. This ensures tables and their AppSync schemas are created automatically during deployment.

```typescript
import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import { RdbConstruct } from '@realdb/cdk';

export class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const rdb = new RdbConstruct(this, 'Rdb', {
      resourceSuffix: 'dev',
      logRetention: logs.RetentionDays.ONE_WEEK,
      
      // Define tables to be created on deployment
      initialTables: [
        {
          tableName: 'chatEvents',
          fields: [
            { name: 'id', type: 'String', primary: true, required: true },
            { name: 'chatId', type: 'String', required: true, indexed: true },
            { name: 'eventType', type: 'String', required: true, indexed: true },
            { name: 'content', type: 'String' },
            { name: 'userId', type: 'String', required: true },
            { name: 'timestamp', type: 'String', required: true },
          ],
          subscriptions: [
            { filters: [{ field: 'chatId', type: 'String' }] }
          ],
          description: 'Real-time chat events for messaging',
        },
        {
          tableName: 'users',
          fields: [
            { name: 'id', type: 'String', primary: true, required: true },
            { name: 'email', type: 'String', required: true, indexed: true },
            { name: 'name', type: 'String', required: true },
            { name: 'status', type: 'String' },
            { name: 'createdAt', type: 'String', required: true },
          ],
          subscriptions: [
            { filters: [{ field: 'id', type: 'String' }] }
          ],
          description: 'User profiles',
        },
      ],
      // API key used for table namespacing in AppSync
      initialTablesApiKey: 'my-app-dev',
    });

    // Tables are created with full AppSync schema including:
    // - Queries: getTbc3d881a_chatEvents, listTbc3d881a_chatEvents
    // - Mutations: createTbc3d881a_chatEvents, updateTbc3d881a_chatEvents, deleteTbc3d881a_chatEvents
    // - Subscriptions: onTbc3d881a_chatEventsCreate, onTbc3d881a_chatEventsUpdate, onTbc3d881a_chatEventsDelete
    // - Publish mutation: publishTbc3d881a_chatEvents (for real-time streaming without DB write)
  }
}
```

#### Field Types

| Type | GraphQL Type | DynamoDB Type |
|------|--------------|---------------|
| `String` | `String` | `S` |
| `Int` | `Int` | `N` |
| `Float` | `Float` | `N` |
| `Boolean` | `Boolean` | `BOOL` |
| `Array` | `[String]` | `L` |

#### Field Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Field name (required) |
| `type` | `string` | Field type: String, Int, Float, Boolean, Array (default: String) |
| `primary` | `boolean` | Mark as primary key (one field required) |
| `required` | `boolean` | Field is required in GraphQL schema |
| `indexed` | `boolean` | Create GSI for efficient queries |

#### Subscription Filters

Subscriptions can be filtered by field values:

```typescript
subscriptions: [
  { 
    filters: [
      { field: 'chatId', type: 'String' },
      { field: 'userId', type: 'String' }
    ] 
  }
]
```

This generates subscriptions like:
```graphql
subscription onChatEventsUpdate($chatId: String, $userId: String) {
  onTbc3d881a_chatEventsUpdate(chatId: $chatId, userId: $userId) {
    id
    chatId
    content
    ...
  }
}
```

#### How It Works

1. **On deployment**: A CloudFormation Custom Resource triggers the `table-init` Lambda
2. **Tables created**: DynamoDB tables are created with proper key schemas and GSIs
3. **Schema stored**: GraphQL schema is stored to S3
4. **EventBridge triggers**: S3 event triggers the `schema-sync` Lambda
5. **AppSync updated**: Schema and resolvers are created in AppSync
6. **Idempotent**: Safe to run multiple times - existing tables are skipped

#### Accessing Initial Tables with SDK

```typescript
import { RdbClient } from '@realdb/client';
import { z } from 'zod';

// The schema matches your initialTables definition
const ChatEventSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  eventType: z.string(),
  content: z.string().optional(),
  userId: z.string(),
  timestamp: z.string(),
});

const client = new RdbClient({
  endpoint: 'https://your-api.execute-api.us-east-1.amazonaws.com/prod',
  apiKey: 'my-app-dev', // Same as initialTablesApiKey
});

const chatEvents = client.tableWithSchema('chatEvents', ChatEventSchema);

// Real-time streaming with publish (no DB write, instant delivery)
await chatEvents.publish({
  id: 'msg-123',
  chatId: 'chat-456',
  eventType: 'message_chunk',
  content: 'Hello...',
  userId: 'user-789',
  timestamp: new Date().toISOString(),
});

// Subscribe to updates
const subscription = chatEvents.subscribe({
  filters: { chatId: 'chat-456' },
  onData: (event) => console.log('Received:', event),
});
subscription.connect();
```

## ⚙️ Configuration Options

### `RdbConstructProps`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `initialTables` | `InitialTableConfig[]` | `undefined` | **RECOMMENDED** Tables to create on deployment with auto AppSync schema sync |
| `initialTablesApiKey` | `string` | auto-generated | API key for namespacing initial tables in AppSync schema |
| `resourceSuffix` | `string` | `''` | Suffix for all resource names (e.g., 'prod' → 'rdb-tables-prod') |
| `apiPrefix` | `string` | `''` | API route prefix (e.g., 'v1' → '/v1/tables', '/v1/tables/{name}/records') |
| `existingApi` | `RestApi` | `undefined` | Use existing API Gateway instead of creating new one |
| `existingTablesTable` | `ITable` | `undefined` | Use existing DynamoDB table for metadata |
| `removalPolicy` | `RemovalPolicy` | `DESTROY` | Resource removal policy. Use `RETAIN` for production to prevent data loss |
| `billingMode` | `BillingMode` | `PAY_PER_REQUEST` | DynamoDB billing mode (`PAY_PER_REQUEST` or `PROVISIONED`) |
| `enableXRayTracing` | `boolean` | `true` | Enable AWS X-Ray tracing on AppSync and Lambda |
| `logRetention` | `RetentionDays` | `ONE_WEEK` | CloudWatch log retention for Lambda functions |
| `enableApiLogging` | `boolean` | `true` | Enable CloudWatch logging for API Gateway |
| `corsOrigins` | `string[]` | `['*']` | Allowed CORS origins for API Gateway |

## 📚 Public Properties

After creating the construct, you can access the following resources:

```typescript
const rdb = new RdbConstruct(this, 'Rdb');

// APIs
rdb.api                          // API Gateway REST API (undefined if existingApi provided)
rdb.appSyncApi                   // AppSync GraphQL API

// Storage
rdb.configBucket                 // S3 bucket for schema storage (versioned)
rdb.tablesTable                  // DynamoDB table for table metadata
rdb.apiKeysTable                 // DynamoDB table for API keys

// Queues
rdb.tableDecommissionQueue       // SQS queue for async table deletion

// Secrets
rdb.apiKeySecret                 // Secrets Manager secret for API keys

// Lambda Functions
rdb.tableManagementFunction      // Table CRUD operations
rdb.recordsManagementFunction    // Record CRUD operations
rdb.apiKeyManagementFunction     // API key management
rdb.schemaSyncFunction           // Schema synchronization from S3
rdb.tableDecommissionFunction    // Async table deletion
rdb.authorizerFunction           // API Gateway Lambda authorizer
rdb.sdkConfigFunction            // SDK configuration endpoint
rdb.tableInitFunction            // Initial table creation (only if initialTables provided)

// Custom Resources
rdb.tableInitCustomResource      // CloudFormation custom resource for initial tables
```

### Example: Grant Additional Permissions

```typescript
const rdb = new RdbConstruct(this, 'Rdb');

// Grant an external Lambda access to RDB tables
myLambda.addToRolePolicy(new iam.PolicyStatement({
  actions: ['dynamodb:GetItem', 'dynamodb:Query'],
  resources: [rdb.tablesTable.tableArn],
}));

// Allow external service to read schemas from S3
myService.addToRolePolicy(new iam.PolicyStatement({
  actions: ['s3:GetObject'],
  resources: [`${rdb.configBucket.bucketArn}/*`],
}));
```

## 🔌 Using with the SDK

After deploying the infrastructure, use the [@realdb/client](https://www.npmjs.com/package/@realdb/client) SDK to interact with your database:

```bash
npm install @realdb/client zod
```

### Complete Example

```typescript
import { RdbClient } from '@realdb/client';
import { z } from 'zod';

// Initialize client with deployed endpoints
const client = new RdbClient({
  endpoint: 'https://your-api-id.execute-api.us-east-1.amazonaws.com/prod',
  apiKey: 'your-api-key',
  apiPrefix: 'v1', // Must match the apiPrefix in CDK deployment
});

// Define schema with Zod
const UserSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});

// Create table from schema
await client.createTableFromSchema('users', UserSchema, {
  indexedFields: ['email'],
  subscriptions: [
    {
      filters: [
        { field: 'email', type: 'string' }
      ]
    }
  ]
});

// Get typed table instance
const users = client.tableWithSchema('users', UserSchema);

// Create record (type-safe!)
const result = await users.create({
  name: 'John Doe',
  email: 'john@example.com',
  age: 30
});

// Subscribe to real-time updates
const subscription = users.subscribe({
  filters: {},
  onData: (user) => {
    console.log('Real-time update:', user);
    // user is typed!
  },
  onError: (error) => {
    console.error('Subscription error:', error);
  }
});

subscription.connect();
```

See the [SDK documentation](https://www.npmjs.com/package/@realdb/client) for complete API reference.

## 📤 CloudFormation Outputs

Add outputs to your stack to easily access deployed resources:

```typescript
const rdb = new RdbConstruct(this, 'Rdb');

new cdk.CfnOutput(this, 'ApiEndpoint', {
  value: rdb.api!.url,
  description: 'API Gateway endpoint',
  exportName: 'RdbApiEndpoint',
});

new cdk.CfnOutput(this, 'AppSyncEndpoint', {
  value: rdb.appSyncApi.graphqlUrl,
  description: 'AppSync GraphQL endpoint for subscriptions',
  exportName: 'RdbAppSyncEndpoint',
});

new cdk.CfnOutput(this, 'AppSyncApiKey', {
  value: rdb.appSyncApi.apiKey || 'N/A',
  description: 'AppSync API key',
});

new cdk.CfnOutput(this, 'ConfigBucket', {
  value: rdb.configBucket.bucketName,
  description: 'S3 bucket for schema storage',
});

new cdk.CfnOutput(this, 'TablesTableName', {
  value: rdb.tablesTable.tableName,
  description: 'DynamoDB table for metadata',
});
```

##  API Reference

### Lambda Functions

| Function | Purpose | Timeout | Memory |
|----------|---------|---------|--------|
| `table-management` | Create/list/delete tables | 15s | 512MB |
| `records-management` | CRUD operations on records | 30s | 512MB |
| `api-key-management` | Create/manage API keys | 15s | 256MB |
| `schema-sync` | Sync schemas to AppSync | 5min | 128MB |
| `table-decommission` | Async table deletion | 10min | 128MB |
| `table-init` | Initial table creation via Custom Resource | 10min | 128MB |
| `authorizer` | API Gateway authorization | 10s | 128MB |
| `sdk-config` | SDK configuration endpoint | 10s | 128MB |

### DynamoDB Tables

**`rdb-tables` (or `rdb-tables-{suffix}`)**:
- Partition Key: `apiKey` (STRING)
- Sort Key: `tableName` (STRING)
- Purpose: Store table metadata and schemas

**`rdb-api-keys` (or `rdb-api-keys-{suffix}`)**:
- Partition Key: `apiKeyId` (STRING)
- Purpose: Store API key metadata (keys encrypted in Secrets Manager)

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## 📄 License

MIT License - see [LICENSE](https://github.com/gilons/rdb/blob/main/LICENSE) for details.

## 🔗 Related Resources

- **SDK**: [@realdb/client](https://www.npmjs.com/package/@realdb/client) - TypeScript SDK for RDB
- **Examples**: [SDK Examples](https://github.com/gilons/rdb/tree/main/packages/sdk/examples/nodejs-basic)
- **GitHub**: [github.com/gilons/rdb](https://github.com/gilons/rdb)
- **Issues**: [Report a bug](https://github.com/gilons/rdb/issues)

**AWS Documentation**:
- [AWS CDK](https://docs.aws.amazon.com/cdk/)
- [AppSync](https://docs.aws.amazon.com/appsync/)
- [DynamoDB](https://docs.aws.amazon.com/dynamodb/)
- [API Gateway](https://docs.aws.amazon.com/apigateway/)

## 📞 Support

For questions or issues:
- 📧 Email: gf.694765457@gmail.com
- 🐛 Issues: [github.com/gilons/rdb/issues](https://github.com/gilons/rdb/issues)

---

**Built with ❤️ using AWS CDK, TypeScript, and serverless technologies**
