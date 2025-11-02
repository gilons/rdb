# rdb-cdk

AWS CDK construct library for deploying RDB (Realtime Database) infrastructure.

## Overview

RDB is a serverless realtime database built on AWS infrastructure. This CDK construct allows you to easily deploy the complete RDB infrastructure to your AWS account.

### Features

- 🚀 **Serverless Architecture** - Built on AWS Lambda, DynamoDB, and AppSync
- ⚡ **Real-time Subscriptions** - WebSocket connections for instant data updates
- 🔐 **Secure by Default** - API key authentication and IAM-based access control
- 📊 **Scalable** - Automatically scales with your application needs
- 🛠️ **Easy to Deploy** - Single CDK construct for complete infrastructure
- 💰 **Cost Effective** - Pay only for what you use

### Architecture

The RDB construct deploys:

- **DynamoDB Tables**: Metadata storage for tables and API keys
- **AppSync GraphQL API**: Real-time subscriptions and mutations
- **API Gateway REST API**: CRUD operations for tables and records
- **Lambda Functions**: Table management, record operations, schema synchronization
- **S3 Bucket**: Schema configuration storage
- **SQS Queue**: Asynchronous table decommissioning
- **Secrets Manager**: Secure API key encryption
- **EventBridge Rules**: Automated schema synchronization

## Installation

```bash
npm install rdb-cdk
```

### Peer Dependencies

This package requires the following peer dependencies:

```bash
npm install aws-cdk-lib constructs
```

## Usage

### Basic Example

```typescript
import * as cdk from 'aws-cdk-lib';
import { RdbConstruct } from '@realdb/cdk';

export class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Deploy RDB infrastructure
    const rdb = new RdbConstruct(this, 'MyRdb');

    // Access the API Gateway endpoint
    new cdk.CfnOutput(this, 'RdbApiUrl', {
      value: rdb.api.url,
    });
  }
}
```

### Advanced Configuration

```typescript
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import { RdbConstruct } from 'rdb-cdk';

const rdb = new RdbConstruct(this, 'MyRdb', {
  // Set removal policy (use RETAIN for production)
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  
  // Configure DynamoDB billing mode
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  
  // Enable X-Ray tracing
  enableXRayTracing: true,
  
  // Set CloudWatch log retention
  logRetention: logs.RetentionDays.ONE_MONTH,
  
  // Enable API Gateway logging
  enableApiLogging: true,
  
  // Configure CORS origins
  corsOrigins: ['https://myapp.example.com'],
});
```

## Configuration Options

### `RdbConstructProps`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `removalPolicy` | `RemovalPolicy` | `DESTROY` | Removal policy for all resources. Use `RETAIN` for production. |
| `billingMode` | `BillingMode` | `PAY_PER_REQUEST` | DynamoDB billing mode for metadata tables. |
| `enableXRayTracing` | `boolean` | `true` | Enable AWS X-Ray tracing on AppSync API. |
| `logRetention` | `RetentionDays` | `ONE_WEEK` | CloudWatch log retention period for Lambda functions. |
| `enableApiLogging` | `boolean` | `true` | Enable CloudWatch logging for API Gateway. |
| `corsOrigins` | `string[]` | `['*']` | Allowed CORS origins for API Gateway. |

## Public Properties

After creating the construct, you can access the following properties:

```typescript
const rdb = new RdbConstruct(this, 'MyRdb');

// API Gateway REST API
const api = rdb.api;

// AppSync GraphQL API
const appSyncApi = rdb.appSyncApi;

// S3 Configuration Bucket
const configBucket = rdb.configBucket;

// DynamoDB Tables
const tablesTable = rdb.tablesTable;
const apiKeysTable = rdb.apiKeysTable;
```

## Using RDB with the SDK

After deploying the infrastructure, use the RDB SDK to interact with your database:

```bash
npm install @realdb/client
```

```typescript
import { RdbClient } from '@realdb/client';

const client = new RdbClient({
  endpoint: 'https://your-api-id.execute-api.region.amazonaws.com/prod',
  apiKey: 'your-api-key',
});

// Create a table
const usersTable = await client.createTable({
  name: 'users',
  schema: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    email: { type: 'string', required: true },
  },
});

// Subscribe to real-time updates
await usersTable.subscribe({
  event: 'create',
  onData: (user) => {
    console.log('New user created:', user);
  },
});
```

## Outputs

The construct creates CloudFormation outputs for important endpoints:

- `ApiEndpoint`: API Gateway REST API endpoint
- `AppSyncEndpoint`: AppSync GraphQL endpoint
- `AppSyncApiKey`: AppSync API key for client connections
- `ConfigBucketName`: S3 bucket name for schema storage

## Cost Considerations

RDB uses serverless AWS services, so costs scale with usage:

- **Lambda**: Pay per request and execution time
- **DynamoDB**: Pay per read/write request (on-demand) or provisioned capacity
- **AppSync**: Pay per request and data transfer
- **API Gateway**: Pay per API call
- **S3**: Pay per storage and requests
- **SQS**: Pay per request (usually minimal)

For development environments, expected costs are typically under $5/month with light usage.

## Security Best Practices

1. **Production Environments**: Use `removalPolicy: cdk.RemovalPolicy.RETAIN` to prevent accidental data loss
2. **CORS Configuration**: Specify exact origins instead of `'*'` in production
3. **API Keys**: Rotate API keys regularly using the API key management endpoints
4. **IAM Policies**: Review and restrict Lambda execution role permissions as needed
5. **VPC Integration**: Consider deploying Lambda functions in a VPC for additional security

## Examples

### Development Stack

```typescript
const devRdb = new RdbConstruct(this, 'DevRdb', {
  removalPolicy: cdk.RemovalPolicy.DESTROY, // Easy cleanup
  logRetention: logs.RetentionDays.ONE_WEEK,
  corsOrigins: ['*'], // Allow all origins for testing
});
```

### Production Stack

```typescript
const prodRdb = new RdbConstruct(this, 'ProdRdb', {
  removalPolicy: cdk.RemovalPolicy.RETAIN, // Prevent data loss
  billingMode: dynamodb.BillingMode.PROVISIONED, // Cost optimization
  logRetention: logs.RetentionDays.ONE_MONTH,
  corsOrigins: ['https://app.example.com'],
  enableXRayTracing: true, // Production monitoring
});
```

## Troubleshooting

### Schema Synchronization Issues

If AppSync schema updates fail, check:
1. S3 bucket permissions for Lambda functions
2. CloudWatch logs for `SchemaSyncFunction`
3. AppSync service role permissions

### API Gateway Authorization Errors

If you receive 401/403 errors:
1. Verify API key is correctly generated
2. Check that `x-api-key` header is included in requests
3. Review Lambda authorizer logs

### DynamoDB Throughput Exceeded

If using provisioned billing mode:
1. Increase read/write capacity units
2. Or switch to `PAY_PER_REQUEST` mode

## Support and Contributing

For issues, feature requests, or contributions, please visit the main RDB repository.

## License

MIT License - See LICENSE file for details

## Related Resources

- [RDB SDK Documentation](https://www.npmjs.com/package/@realdb/client)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/latest/guide/home.html)
- [AppSync Documentation](https://docs.aws.amazon.com/appsync/)
- [DynamoDB Documentation](https://docs.aws.amazon.com/dynamodb/)
