import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';

/**
 * Configuration options for the RDB construct
 */
export interface RdbConstructProps {
  /**
   * Removal policy for all resources (DESTROY for dev, RETAIN for prod)
   * @default cdk.RemovalPolicy.DESTROY
   */
  removalPolicy?: cdk.RemovalPolicy;

  /**
   * DynamoDB billing mode for metadata tables
   * @default dynamodb.BillingMode.PAY_PER_REQUEST
   */
  billingMode?: dynamodb.BillingMode;

  /**
   * Enable X-Ray tracing on AppSync API
   * @default true
   */
  enableXRayTracing?: boolean;

  /**
   * CloudWatch log retention for Lambda functions
   * @default logs.RetentionDays.ONE_WEEK
   */
  logRetention?: logs.RetentionDays;

  /**
   * Enable API Gateway access logging
   * @default true
   */
  enableApiLogging?: boolean;

  /**
   * CORS origins for API Gateway
   * @default ['*']
   */
  corsOrigins?: string[];

  /**
   * Existing API Gateway to add RDB routes to (optional)
   * If provided, RDB will add its routes to this API instead of creating a new one
   */
  existingApi?: apigateway.RestApi;

  /**
   * Existing DynamoDB table to use for table metadata (optional)
   * If provided, RDB will use this table instead of creating a new one
   */
  existingTablesTable?: dynamodb.ITable;

  /**
   * API route prefix for all RDB endpoints
   * @default '' (no prefix)
   * @example 'rdb' will create routes like /rdb/tables, /rdb/tables/{tableName}/records
   */
  apiPrefix?: string;

  /**
   * Suffix to append to all resource names for uniqueness
   * @default '' (no suffix)
   * @example 'dev' will create resources like rdb-tables-dev, rdb-api-keys-dev
   */
  resourceSuffix?: string;
}

/**
 * RDB (Realtime Database) Construct
 * 
 * Deploys a complete serverless realtime database infrastructure including:
 * - DynamoDB tables for metadata and user data
 * - AppSync GraphQL API for realtime subscriptions
 * - API Gateway REST API for CRUD operations
 * - Lambda functions for table/record management
 * - S3 bucket for schema storage
 * - SQS queue for async table decommissioning
 */
export class RdbConstruct extends Construct {
  /**
   * The API Gateway REST API (if created)
   */
  public readonly api?: apigateway.RestApi;

  /**
   * The AppSync GraphQL API for realtime subscriptions
   */
  public readonly appSyncApi: appsync.GraphqlApi;

  /**
   * The S3 bucket storing configuration files
   */
  public readonly configBucket: s3.Bucket;

  /**
   * The DynamoDB table storing table metadata
   */
  public readonly tablesTable: dynamodb.ITable;

  /**
   * The DynamoDB table storing API keys
   */
  public readonly apiKeysTable: dynamodb.Table;

  /**
   * The SQS queue for table decommission tasks
   */
  public readonly tableDecommissionQueue: sqs.Queue;

  /**
   * The Secrets Manager secret for API key encryption
   */
  public readonly apiKeySecret: secretsmanager.Secret;

  /**
   * Lambda functions
   */
  public readonly tableManagementFunction: lambda.Function;
  public readonly recordsManagementFunction: lambda.Function;
  public readonly apiKeyManagementFunction: lambda.Function;
  public readonly schemaSyncFunction: lambda.Function;
  public readonly tableDecommissionFunction: lambda.Function;
  public readonly authorizerFunction: lambda.Function;
  public readonly sdkConfigFunction: lambda.Function;

  /**
   * The nested stack (if useNestedStack is true)
   */
  public readonly nestedStack?: cdk.NestedStack;

  constructor(scope: Construct, id: string, props: RdbConstructProps = {}) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.DESTROY;
    const billingMode = props.billingMode ?? dynamodb.BillingMode.PAY_PER_REQUEST;
    const enableXRayTracing = props.enableXRayTracing ?? true;
    const logRetention = props.logRetention ?? logs.RetentionDays.ONE_WEEK;
    const enableApiLogging = props.enableApiLogging ?? true;
    const corsOrigins = props.corsOrigins ?? apigateway.Cors.ALL_ORIGINS;
    const apiPrefix = props.apiPrefix ?? '';
    const resourceSuffix = props.resourceSuffix ?? '';

    // Helper function to generate resource names with suffix
    const resourceName = (baseName: string) => resourceSuffix ? `${baseName}-${resourceSuffix}` : baseName;

    // ========================================
    // DYNAMODB TABLES
    // ========================================

    // Tables metadata table (use existing or create new)
    this.tablesTable = props.existingTablesTable ?? new dynamodb.Table(this, 'TablesTable', {
      tableName: resourceName('rdb-tables'),
      partitionKey: { name: 'apiKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'tableName', type: dynamodb.AttributeType.STRING },
      billingMode,
      removalPolicy,
    });

    // API keys table
    this.apiKeysTable = new dynamodb.Table(this, 'ApiKeysTable', {
      tableName: resourceName('rdb-api-keys'),
      partitionKey: { name: 'apiKeyId', type: dynamodb.AttributeType.STRING },
      billingMode,
      removalPolicy,
    });

    // ========================================
    // S3 BUCKET
    // ========================================

    this.configBucket = new s3.Bucket(this, 'ConfigBucket', {
      bucketName: resourceName(`rdb-config-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`),
      versioned: true,
      removalPolicy,
      autoDeleteObjects: removalPolicy === cdk.RemovalPolicy.DESTROY,
      eventBridgeEnabled: true,
    });

    // ========================================
    // SQS QUEUE
    // ========================================

    // Dead Letter Queue for failed table decommissions
    const tableDecommissionDLQ = new sqs.Queue(this, 'TableDecommissionDLQ', {
      queueName: resourceName('rdb-table-decommission-dlq'),
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy,
    });

    this.tableDecommissionQueue = new sqs.Queue(this, 'TableDecommissionQueue', {
      queueName: resourceName('rdb-table-decommission-queue'),
      visibilityTimeout: cdk.Duration.minutes(10),
      retentionPeriod: cdk.Duration.days(7),
      deadLetterQueue: {
        queue: tableDecommissionDLQ,
        maxReceiveCount: 3,
      },
      removalPolicy,
    });

    // ========================================
    // SECRETS MANAGER
    // ========================================

    this.apiKeySecret = new secretsmanager.Secret(this, 'ApiKeySecret', {
      secretName: resourceName('rdb-api-keys'),
      description: 'Encrypted API keys for RDB service',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ masterKey: '' }),
        generateStringKey: 'masterKey',
        excludeCharacters: '"@/\\',
      },
      removalPolicy,
    });

    // ========================================
    // APPSYNC GRAPHQL API
    // ========================================

    this.appSyncApi = new appsync.GraphqlApi(this, 'AppSyncApi', {
      name: resourceName('rdb-appsync-api'),
      definition: appsync.Definition.fromSchema(appsync.SchemaFile.fromAsset(
        path.join(__dirname, '../schema/base-schema.graphql')
      )),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: cdk.Expiration.after(cdk.Duration.days(365)),
          },
        },
      },
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ALL,
        retention: logRetention,
        excludeVerboseContent: false,
      },
      xrayEnabled: enableXRayTracing,
    });

    // ========================================
    // IAM ROLES
    // ========================================

    // AppSync service role for DynamoDB access
    const appSyncServiceRole = new iam.Role(this, 'AppSyncServiceRole', {
      assumedBy: new iam.ServicePrincipal('appsync.amazonaws.com'),
      inlinePolicies: {
        DynamoDbAccessPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:DeleteItem',
                'dynamodb:UpdateItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [`arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/rdb-data-*`],
            }),
          ],
        }),
      },
    });

    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    // Table management Lambda
    this.tableManagementFunction = new NodejsFunction(this, 'TableManagementFunction', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      functionName: resourceName('rdb-table-management'),
      entry: path.join(__dirname, '../../lambdas/table-managements/index.ts'),
      handler: 'handler',
      environment: {
        TABLES_TABLE_NAME: this.tablesTable.tableName,
        CONFIG_BUCKET_NAME: this.configBucket.bucketName,
        APPSYNC_API_ID: this.appSyncApi.apiId,
        DECOMMISSION_QUEUE_URL: this.tableDecommissionQueue.queueUrl,
      },
      logRetention,
    });

    // Records management Lambda
    this.recordsManagementFunction = new NodejsFunction(this, 'RecordsManagementFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      functionName: resourceName('rdb-records-management'),
      entry: path.join(__dirname, '../../lambdas/records-management/index.ts'),
      handler: 'handler',
      environment: {
        TABLES_TABLE_NAME: this.tablesTable.tableName,
        APPSYNC_API_ID: this.appSyncApi.apiId,
        APPSYNC_API_URL: this.appSyncApi.graphqlUrl,
        APPSYNC_API_KEY: this.appSyncApi.apiKey || '',
      },
      logRetention,
    });

    // API key management Lambda
    this.apiKeyManagementFunction = new NodejsFunction(this, 'ApiKeyManagementFunction', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      functionName: resourceName('rdb-api-key-management'),
      entry: path.join(__dirname, '../../lambdas/api-key-management/index.ts'),
      handler: 'handler',
      environment: {
        API_KEYS_TABLE_NAME: this.apiKeysTable.tableName,
        SECRET_NAME: this.apiKeySecret.secretName,
      },
      logRetention,
    });

    // AppSync schema synchronization Lambda
    this.schemaSyncFunction = new NodejsFunction(this, 'SchemaSyncFunction', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      functionName: resourceName('rdb-schema-sync'),
      entry: path.join(__dirname, '../../lambdas/schema-sync/index.ts'),
      handler: 'handler',
      environment: {
        CONFIG_BUCKET_NAME: this.configBucket.bucketName,
        APPSYNC_API_ID: this.appSyncApi.apiId,
        APPSYNC_SERVICE_ROLE_ARN: appSyncServiceRole.roleArn,
      },
      timeout: cdk.Duration.minutes(5),
      logRetention,
    });

    // Table decommission Lambda (async worker)
    this.tableDecommissionFunction = new NodejsFunction(this, 'TableDecommissionFunction', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      functionName: resourceName('rdb-table-decommission'),
      entry: path.join(__dirname, '../../lambdas/table-decommission/index.ts'),
      handler: 'handler',
      environment: {
        TABLES_TABLE_NAME: this.tablesTable.tableName,
        CONFIG_BUCKET_NAME: this.configBucket.bucketName,
        APPSYNC_API_ID: this.appSyncApi.apiId,
      },
      timeout: cdk.Duration.minutes(10),
      logRetention,
    });

    // Connect decommission lambda to SQS queue
    this.tableDecommissionFunction.addEventSource(new SqsEventSource(this.tableDecommissionQueue, {
      batchSize: 1,
    }));

    // Lambda authorizer for API Gateway
    this.authorizerFunction = new NodejsFunction(this, 'AuthorizerFunction', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      functionName: resourceName('rdb-authorizer'),
      entry: path.join(__dirname, '../../lambdas/authorizer/index.ts'),
      handler: 'handler',
      environment: {
        API_KEYS_TABLE_NAME: this.apiKeysTable.tableName,
        SECRET_NAME: this.apiKeySecret.secretName,
      },
      timeout: cdk.Duration.seconds(10),
      logRetention,
    });

    // SDK configuration Lambda
    this.sdkConfigFunction = new NodejsFunction(this, 'SdkConfigFunction', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      functionName: resourceName('rdb-sdk-config'),
      entry: path.join(__dirname, '../../lambdas/sdk-config/index.ts'),
      handler: 'handler',
      environment: {
        APPSYNC_API_ID: this.appSyncApi.apiId,
        APPSYNC_API_GQL_URL: this.appSyncApi.graphqlUrl,
      },
      timeout: cdk.Duration.seconds(10),
      logRetention,
    });

    // ========================================
    // PERMISSIONS
    // ========================================

    // Grant DynamoDB permissions
    this.tablesTable.grantReadWriteData(this.tableManagementFunction);
    this.tablesTable.grantReadData(this.recordsManagementFunction);
    this.apiKeysTable.grantReadWriteData(this.apiKeyManagementFunction);
    this.apiKeysTable.grantReadWriteData(this.authorizerFunction);

    // Grant additional DynamoDB permissions for table management
    const dynamoDbPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:CreateTable',
        'dynamodb:DeleteTable',
        'dynamodb:DescribeTable',
        'dynamodb:ListTables',
        'dynamodb:UpdateTable',
        'dynamodb:TagResource',
        'dynamodb:UntagResource',
        'dynamodb:ListTagsOfResource',
        'dynamodb:PutItem',
        'dynamodb:GetItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:BatchGetItem',
        'dynamodb:BatchWriteItem'
      ],
      resources: [
        `arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/rdb-data-*`,
        `arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/rdb-data-*/index/*`
      ]
    });

    this.tableManagementFunction.addToRolePolicy(dynamoDbPolicy);
    this.recordsManagementFunction.addToRolePolicy(dynamoDbPolicy);
    this.tableDecommissionFunction.addToRolePolicy(dynamoDbPolicy);

    // Grant DynamoDB permissions to decommission lambda
    this.tablesTable.grantReadWriteData(this.tableDecommissionFunction);

    // Grant S3 permissions
    this.configBucket.grantReadWrite(this.tableManagementFunction);
    this.configBucket.grantRead(this.schemaSyncFunction);
    this.configBucket.grantReadWrite(this.tableDecommissionFunction);

    // Grant SQS permissions to table management function
    this.tableDecommissionQueue.grantSendMessages(this.tableManagementFunction);

    // Secrets Manager permissions
    this.apiKeySecret.grantRead(this.authorizerFunction);
    this.apiKeySecret.grantRead(this.apiKeyManagementFunction);
    this.apiKeySecret.grantWrite(this.apiKeyManagementFunction);

    // Grant AppSync permissions
    const appSyncPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'appsync:UpdateGraphqlApi',
        'appsync:GetGraphqlApi',
        'appsync:UpdateApiKey',
        'appsync:ListApiKeys',
        'appsync:CreateApiKey',
        'appsync:DeleteApiKey',
        'appsync:GetSchemaCreationStatus',
        'appsync:StartSchemaCreation',
        'appsync:UpdateResolver',
        'appsync:CreateResolver',
        'appsync:DeleteResolver',
        'appsync:GetResolver',
        'appsync:ListResolvers',
        'appsync:CreateDataSource',
        'appsync:UpdateDataSource',
        'appsync:DeleteDataSource',
        'appsync:GetDataSource',
        'appsync:ListDataSources',
      ],
      resources: [
        this.appSyncApi.arn,
        `${this.appSyncApi.arn}/*`,
        `arn:aws:appsync:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:/v1/apis/${this.appSyncApi.apiId}`,
        `arn:aws:appsync:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:/v1/apis/${this.appSyncApi.apiId}/*`,
        `arn:aws:appsync:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:/createdatasource`
      ],
    });

    this.tableManagementFunction.addToRolePolicy(appSyncPolicy);
    this.schemaSyncFunction.addToRolePolicy(appSyncPolicy);
    this.tableDecommissionFunction.addToRolePolicy(appSyncPolicy);

    // Grant Schema Sync function permission to pass the AppSync Service Role
    const passRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [appSyncServiceRole.roleArn],
    });
    this.schemaSyncFunction.addToRolePolicy(passRolePolicy);

    // Grant SDK config function permissions to read AppSync API keys
    const appSyncReadPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'appsync:ListApiKeys',
        'appsync:GetGraphqlApi',
      ],
      resources: [
        this.appSyncApi.arn,
        `${this.appSyncApi.arn}/*`,
        `arn:aws:appsync:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:/v1/apis/${this.appSyncApi.apiId}/*`
      ],
    });

    this.sdkConfigFunction.addToRolePolicy(appSyncReadPolicy);

    // ========================================
    // API GATEWAY
    // ========================================

    // Lambda authorizer
    const authorizer = new apigateway.RequestAuthorizer(this, 'RdbAuthorizer', {
      handler: this.authorizerFunction,
      identitySources: [apigateway.IdentitySource.header('x-api-key')],
      resultsCacheTtl: cdk.Duration.seconds(0),
    });

    // API Gateway (use existing or create new)
    this.api = props.existingApi ?? new apigateway.RestApi(this, 'RdbApi', {
      restApiName: resourceName('rdb-api'),
      description: 'Realtime Database API',
      cloudWatchRole: enableApiLogging,
      cloudWatchRoleRemovalPolicy: removalPolicy,
      deployOptions: {
        stageName: 'prod',
        loggingLevel: enableApiLogging ? apigateway.MethodLoggingLevel.INFO : apigateway.MethodLoggingLevel.OFF,
        dataTraceEnabled: enableApiLogging,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: corsOrigins,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // API routes - support API prefix
    const rootResource = apiPrefix ? this.api.root.addResource(apiPrefix) : this.api.root;
    const tablesResource = rootResource.addResource('tables');
    tablesResource.addMethod('GET', new apigateway.LambdaIntegration(this.tableManagementFunction), {
      authorizer,
    });
    tablesResource.addMethod('POST', new apigateway.LambdaIntegration(this.tableManagementFunction), {
      authorizer,
    });

    const tableResource = tablesResource.addResource('{tableName}');
    tableResource.addMethod('PUT', new apigateway.LambdaIntegration(this.tableManagementFunction), {
      authorizer,
    });
    tableResource.addMethod('DELETE', new apigateway.LambdaIntegration(this.tableManagementFunction), {
      authorizer,
    });

    const recordsResource = tableResource.addResource('records');
    recordsResource.addMethod('GET', new apigateway.LambdaIntegration(this.recordsManagementFunction), {
      authorizer,
    });
    recordsResource.addMethod('POST', new apigateway.LambdaIntegration(this.recordsManagementFunction), {
      authorizer,
    });

    const recordResource = recordsResource.addResource('{recordId}');
    recordResource.addMethod('GET', new apigateway.LambdaIntegration(this.recordsManagementFunction), {
      authorizer,
    });
    recordResource.addMethod('PUT', new apigateway.LambdaIntegration(this.recordsManagementFunction), {
      authorizer,
    });
    recordResource.addMethod('DELETE', new apigateway.LambdaIntegration(this.recordsManagementFunction), {
      authorizer,
    });

    // API key management (no auth required for key generation)
    const apiKeysResource = this.api.root.addResource('api-keys');
    apiKeysResource.addMethod('POST', new apigateway.LambdaIntegration(this.apiKeyManagementFunction));

    // SDK configuration endpoint (requires authentication)
    const sdkResource = this.api.root.addResource('sdk');
    const configResource = sdkResource.addResource('config');
    configResource.addMethod('GET', new apigateway.LambdaIntegration(this.sdkConfigFunction), {
      authorizer,
    });

    // ========================================
    // EVENT BRIDGE RULES
    // ========================================

    // S3 configuration change event rule
    const s3ConfigChangeRule = new events.Rule(this, 'S3ConfigChangeRule', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [this.configBucket.bucketName],
          },
          object: {
            key: [{ prefix: 'schemas/' }],
          },
        },
      },
    });

    s3ConfigChangeRule.addTarget(new targets.LambdaFunction(this.schemaSyncFunction));

    // ========================================
    // OUTPUTS
    // ========================================

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'RDB API Gateway endpoint',
      exportName: resourceName('rdb-api-endpoint'),
    });

    new cdk.CfnOutput(this, 'AppSyncEndpoint', {
      value: this.appSyncApi.graphqlUrl,
      description: 'AppSync GraphQL endpoint',
      exportName: resourceName('rdb-appsync-endpoint'),
    });

    new cdk.CfnOutput(this, 'AppSyncApiId', {
      value: this.appSyncApi.apiId,
      description: 'AppSync API ID',
      exportName: resourceName('rdb-appsync-api-id'),
    });

    new cdk.CfnOutput(this, 'AppSyncApiKey', {
      value: this.appSyncApi.apiKey!,
      description: 'AppSync API Key',
      exportName: resourceName('rdb-appsync-api-key'),
    });

    new cdk.CfnOutput(this, 'ConfigBucketName', {
      value: this.configBucket.bucketName,
      description: 'S3 bucket for configurations',
      exportName: resourceName('rdb-config-bucket'),
    });

    new cdk.CfnOutput(this, 'TablesTableName', {
      value: this.tablesTable.tableName,
      description: 'DynamoDB table for table metadata',
      exportName: resourceName('rdb-tables-table'),
    });

    new cdk.CfnOutput(this, 'ApiKeysTableName', {
      value: this.apiKeysTable.tableName,
      description: 'DynamoDB table for API keys',
      exportName: resourceName('rdb-api-keys-table'),
    });

    new cdk.CfnOutput(this, 'ApiKeySecretArn', {
      value: this.apiKeySecret.secretArn,
      description: 'Secrets Manager secret ARN for API key encryption',
      exportName: resourceName('rdb-api-key-secret-arn'),
    });

    new cdk.CfnOutput(this, 'TableDecommissionQueueUrl', {
      value: this.tableDecommissionQueue.queueUrl,
      description: 'SQS queue URL for table decommission tasks',
      exportName: resourceName('rdb-decommission-queue-url'),
    });
  }
}
