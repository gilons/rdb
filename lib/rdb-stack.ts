import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RdbConstruct } from '@realdb/rdb-cdk';

/**
 * RDB Stack - Reference implementation using the @realdb/rdb-cdk construct
 * 
 * This stack demonstrates how to use the RdbConstruct from the rdb-cdk package.
 * After publishing rdb-cdk to npm, users can install and use it like this:
 * 
 * \`\`\`typescript
 * import { RdbConstruct } from '@realdb/rdb-cdk';
 * 
 * export class MyStack extends cdk.Stack {
 *   constructor(scope: Construct, id: string, props?: cdk.StackProps) {
 *     super(scope, id, props);
 *     
 *     // Deploy complete RDB infrastructure with one construct
 *     const rdb = new RdbConstruct(this, 'MyRdb', {
 *       // Optional: configure removal policy
 *       removalPolicy: cdk.RemovalPolicy.DESTROY,
 *     });
 *   }
 * }
 * \`\`\`
 */
export class RdbStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Deploy complete RDB infrastructure using the reusable construct
    // This single line creates all necessary resources:
    // - DynamoDB tables (metadata + user data)
    // - AppSync GraphQL API (real-time subscriptions)
    // - API Gateway REST API (CRUD operations)
    // - Lambda functions (table/record management, auth, schema sync)
    // - S3 bucket (schema storage)
    // - SQS queue (async table decommissioning)
    // - Secrets Manager (API key encryption)
    // - EventBridge rules (automated schema sync)
    new RdbConstruct(this, 'Rdb', {
      // Use DESTROY for development to easily clean up resources
      // For production, use cdk.RemovalPolicy.RETAIN to prevent data loss
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      resourceSuffix: 'example'
      
      // Optional: Configure other properties
      // billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // enableXRayTracing: true,
      // logRetention: logs.RetentionDays.ONE_WEEK,
      // enableApiLogging: true,
      // corsOrigins: ['https://myapp.example.com'],
    });

    // Note: All outputs (API endpoints, AppSync GraphQL URL, etc.)
    // are automatically created by the RdbConstruct
  }
}
