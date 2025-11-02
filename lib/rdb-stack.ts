import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

export class RdbStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly appSyncApi: appsync.GraphqlApi;
  public readonly configBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ========================================
    // CORE STORAGE RESOURCES
    // ========================================

    // DynamoDB table for storing user tables metadata
    const tablesTable = new dynamodb.Table(this, 'TablesTable', {
      tableName: 'rdb-tables',
      partitionKey: { name: 'apiKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'tableName', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DynamoDB table for storing API keys metadata
    const apiKeysTable = new dynamodb.Table(this, 'ApiKeysTable', {
      tableName: 'rdb-api-keys',
      partitionKey: { name: 'apiKeyId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // S3 bucket for storing AppSync schema configurations
    this.configBucket = new s3.Bucket(this, 'ConfigBucket', {
      bucketName: `rdb-config-${this.account}-${this.region}`,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      eventBridgeEnabled: true,
    });

    // SQS queue for table decommissioning
    const tableDecommissionQueue = new sqs.Queue(this, 'TableDecommissionQueue', {
      queueName: 'rdb-table-decommission-queue',
      visibilityTimeout: cdk.Duration.minutes(10), // Longer timeout for decommissioning
      retentionPeriod: cdk.Duration.days(7),
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'TableDecommissionDLQ', {
          queueName: 'rdb-table-decommission-dlq',
          retentionPeriod: cdk.Duration.days(14),
        }),
        maxReceiveCount: 3, // Retry up to 3 times before moving to DLQ
      },
    });

    // Secrets Manager for storing API key secrets
    const apiKeySecret = new secretsmanager.Secret(this, 'ApiKeySecret', {
      secretName: 'rdb-api-keys',
      description: 'Encrypted API keys for RDB service',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ masterKey: '' }),
        generateStringKey: 'masterKey',
        excludeCharacters: '"@/\\',
      },
    });

    // ========================================
    // APPSYNC GRAPHQL API
    // ========================================

    this.appSyncApi = new appsync.GraphqlApi(this, 'RdbGraphqlApi', {
      name: 'rdb-realtime-api',
      schema: appsync.SchemaFile.fromAsset('src/schema/base-schema.graphql'),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: cdk.Expiration.after(cdk.Duration.days(365)),
          },
        },
      },
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ALL, // Log all field resolver executions
        retention: logs.RetentionDays.ONE_WEEK,
        excludeVerboseContent: false, // Include full request/response details
      },
      xrayEnabled: true, // Enable X-Ray tracing for performance monitoring
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
              resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/rdb-data-*`],
            }),
          ],
        }),
      },
    });

    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    // Table management Lambda
    const tableManagementFunction = new NodejsFunction(this, 'TableManagementFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: 'src/lambdas/table-managements/index.ts',
      handler: 'handler',
      environment: {
        TABLES_TABLE_NAME: tablesTable.tableName,
        CONFIG_BUCKET_NAME: this.configBucket.bucketName,
        APPSYNC_API_ID: this.appSyncApi.apiId,
        DECOMMISSION_QUEUE_URL: tableDecommissionQueue.queueUrl,
      },
    });

    // Records management Lambda
    const recordsManagementFunction = new NodejsFunction(this, 'RecordsManagementFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: 'src/lambdas/records-management/index.ts',
      handler: 'handler',
      environment: {
        TABLES_TABLE_NAME: tablesTable.tableName,
        APPSYNC_API_ID: this.appSyncApi.apiId,
        APPSYNC_API_URL: this.appSyncApi.graphqlUrl,
        APPSYNC_API_KEY: this.appSyncApi.apiKey || '',
      },
    });

    // API key management Lambda
    const apiKeyManagementFunction = new NodejsFunction(this, 'ApiKeyManagementFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: 'src/lambdas/api-key-management/index.ts',
      handler: 'handler',
      environment: {
        API_KEYS_TABLE_NAME: apiKeysTable.tableName,
        SECRET_NAME: apiKeySecret.secretName,
      },
    });

    // AppSync schema synchronization Lambda
    const schemaSyncFunction = new NodejsFunction(this, 'SchemaSyncFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: 'src/lambdas/schema-sync/index.ts',
      handler: 'handler',
      environment: {
        CONFIG_BUCKET_NAME: this.configBucket.bucketName,
        APPSYNC_API_ID: this.appSyncApi.apiId,
        APPSYNC_SERVICE_ROLE_ARN: appSyncServiceRole.roleArn,
      },
      timeout: cdk.Duration.minutes(5)
    });

    // Table decommission Lambda (async worker)
    const tableDecommissionFunction = new NodejsFunction(this, 'TableDecommissionFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: 'src/lambdas/table-decommission/index.ts',
      handler: 'handler',
      environment: {
        TABLES_TABLE_NAME: tablesTable.tableName,
        CONFIG_BUCKET_NAME: this.configBucket.bucketName,
        APPSYNC_API_ID: this.appSyncApi.apiId,
      },
      timeout: cdk.Duration.minutes(10), // Longer timeout for decommissioning
    });

    // Connect decommission lambda to SQS queue
    tableDecommissionFunction.addEventSource(new SqsEventSource(tableDecommissionQueue, {
      batchSize: 1, // Process one table at a time
    }));

    // Lambda authorizer for API Gateway
    const authorizerFunction = new NodejsFunction(this, 'AuthorizerFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: 'src/lambdas/authorizer/index.ts',
      handler: 'handler',
      environment: {
        API_KEYS_TABLE_NAME: apiKeysTable.tableName,
        SECRET_NAME: apiKeySecret.secretName,
      },
      timeout: cdk.Duration.seconds(10)
    });

    // SDK configuration Lambda
    const sdkConfigFunction = new NodejsFunction(this, 'SdkConfigFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: 'src/lambdas/sdk-config/index.ts',
      handler: 'handler',
      environment: {
        APPSYNC_API_ID: this.appSyncApi.apiId,
        APPSYNC_API_GQL_URL: this.appSyncApi.graphqlUrl,
      },
      timeout: cdk.Duration.seconds(10)
    });

    // ========================================
    // PERMISSIONS
    // ========================================

    // Grant DynamoDB permissions
    tablesTable.grantReadWriteData(tableManagementFunction);
    tablesTable.grantReadData(recordsManagementFunction);
    apiKeysTable.grantReadWriteData(apiKeyManagementFunction);
    apiKeysTable.grantReadWriteData(authorizerFunction); // Changed to ReadWrite for timestamp updates

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
        // User data table permissions (for tables created by the API)
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
        `arn:aws:dynamodb:${this.region}:${this.account}:table/rdb-data-*`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/rdb-data-*/index/*`
      ]
    });

    tableManagementFunction.addToRolePolicy(dynamoDbPolicy);
    recordsManagementFunction.addToRolePolicy(dynamoDbPolicy);
    tableDecommissionFunction.addToRolePolicy(dynamoDbPolicy);

    // Grant DynamoDB permissions to decommission lambda
    tablesTable.grantReadWriteData(tableDecommissionFunction);

    // Grant S3 permissions
    this.configBucket.grantReadWrite(tableManagementFunction);
    this.configBucket.grantRead(schemaSyncFunction);
    this.configBucket.grantReadWrite(tableDecommissionFunction);

    // Grant SQS permissions to table management function
    tableDecommissionQueue.grantSendMessages(tableManagementFunction);

    // Secrets Manager permissions
    apiKeySecret.grantRead(authorizerFunction);
    apiKeySecret.grantRead(apiKeyManagementFunction);
    apiKeySecret.grantWrite(apiKeyManagementFunction);

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
    // Grant permissions on the API itself
    this.appSyncApi.arn, 
    // Grant permissions on the resources within the API (datasources, resolvers, etc.)
    `${this.appSyncApi.arn}/*`,
    `arn:aws:appsync:${this.region}:${this.account}:/v1/apis/${this.appSyncApi.apiId}`,
    `arn:aws:appsync:${this.region}:${this.account}:/v1/apis/${this.appSyncApi.apiId}/*`,
    `arn:aws:appsync:${this.region}:${this.account}:/createdatasource`
  ],
});

    tableManagementFunction.addToRolePolicy(appSyncPolicy);
    schemaSyncFunction.addToRolePolicy(appSyncPolicy);
    tableDecommissionFunction.addToRolePolicy(appSyncPolicy);

    // Grant Schema Sync function permission to pass the AppSync Service Role
    const passRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [appSyncServiceRole.roleArn],
    });
    schemaSyncFunction.addToRolePolicy(passRolePolicy);

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
        `arn:aws:appsync:${this.region}:${this.account}:/v1/apis/${this.appSyncApi.apiId}/*`
      ],
    });

    sdkConfigFunction.addToRolePolicy(appSyncReadPolicy);

    // ========================================
    // API GATEWAY
    // ========================================

    // Lambda authorizer
    const authorizer = new apigateway.RequestAuthorizer(this, 'RdbAuthorizer', {
      handler: authorizerFunction,
      identitySources: [apigateway.IdentitySource.header('x-api-key')],
      resultsCacheTtl: cdk.Duration.seconds(0), // Disable caching to avoid authorization issues
    });

    // API Gateway
    this.api = new apigateway.RestApi(this, 'RdbApi', {
      restApiName: 'rdb-api',
      description: 'Realtime Database API',
      cloudWatchRole: true,
      cloudWatchRoleRemovalPolicy: cdk.RemovalPolicy.DESTROY,
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // API routes
    const tablesResource = this.api.root.addResource('tables');
    tablesResource.addMethod('GET', new apigateway.LambdaIntegration(tableManagementFunction), {
      authorizer,
    });
    tablesResource.addMethod('POST', new apigateway.LambdaIntegration(tableManagementFunction), {
      authorizer,
    });

    const tableResource = tablesResource.addResource('{tableName}');
    tableResource.addMethod('PUT', new apigateway.LambdaIntegration(tableManagementFunction), {
      authorizer,
    });
    tableResource.addMethod('DELETE', new apigateway.LambdaIntegration(tableManagementFunction), {
      authorizer,
    });

    const recordsResource = tableResource.addResource('records');
    recordsResource.addMethod('GET', new apigateway.LambdaIntegration(recordsManagementFunction), {
      authorizer,
    });
    recordsResource.addMethod('POST', new apigateway.LambdaIntegration(recordsManagementFunction), {
      authorizer,
    });

    const recordResource = recordsResource.addResource('{recordId}');
    recordResource.addMethod('GET', new apigateway.LambdaIntegration(recordsManagementFunction), {
      authorizer,
    });
    recordResource.addMethod('PUT', new apigateway.LambdaIntegration(recordsManagementFunction), {
      authorizer,
    });
    recordResource.addMethod('DELETE', new apigateway.LambdaIntegration(recordsManagementFunction), {
      authorizer,
    });

    // API key management (no auth required for key generation)
    const apiKeysResource = this.api.root.addResource('api-keys');
    apiKeysResource.addMethod('POST', new apigateway.LambdaIntegration(apiKeyManagementFunction));

    // SDK configuration endpoint (requires authentication)
    const sdkResource = this.api.root.addResource('sdk');
    const configResource = sdkResource.addResource('config');
    configResource.addMethod('GET', new apigateway.LambdaIntegration(sdkConfigFunction), {
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

    s3ConfigChangeRule.addTarget(new targets.LambdaFunction(schemaSyncFunction));

    // ========================================
    // OUTPUTS
    // ========================================

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'RDB API Gateway endpoint',
    });

    new cdk.CfnOutput(this, 'AppSyncEndpoint', {
      value: this.appSyncApi.graphqlUrl,
      description: 'AppSync GraphQL endpoint',
    });

    new cdk.CfnOutput(this, 'AppSyncApiKey', {
      value: this.appSyncApi.apiKey!,
      description: 'AppSync API Key',
    });

    new cdk.CfnOutput(this, 'ConfigBucketName', {
      value: this.configBucket.bucketName,
      description: 'S3 bucket for configurations',
    });
  }
}
