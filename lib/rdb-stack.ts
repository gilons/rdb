import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
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
        retention: logs.RetentionDays.ONE_WEEK,
      },
    });

    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    // Table management Lambda
    const tableManagementFunction = new NodejsFunction(this, 'TableManagementFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/lambdas/table-management/index.ts',
      handler: 'handler',
      environment: {
        TABLES_TABLE_NAME: tablesTable.tableName,
        CONFIG_BUCKET_NAME: this.configBucket.bucketName,
        APPSYNC_API_ID: this.appSyncApi.apiId,
      },
      timeout: cdk.Duration.seconds(30)
    });

    // Records management Lambda
    const recordsManagementFunction = new NodejsFunction(this, 'RecordsManagementFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/lambdas/records-management/index.ts',
      handler: 'handler',
      environment: {
        TABLES_TABLE_NAME: tablesTable.tableName,
        APPSYNC_API_ID: this.appSyncApi.apiId,
      },
      timeout: cdk.Duration.seconds(30),
    });

    // API key management Lambda
    const apiKeyManagementFunction = new NodejsFunction(this, 'ApiKeyManagementFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/lambdas/api-key-management/index.ts',
      handler: 'handler',
      environment: {
        API_KEYS_TABLE_NAME: apiKeysTable.tableName,
        SECRET_NAME: apiKeySecret.secretName,
      },
      timeout: cdk.Duration.seconds(30),
    });

    // AppSync schema synchronization Lambda
    const schemaSyncFunction = new NodejsFunction(this, 'SchemaSyncFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/lambdas/schema-sync/index.ts',
      handler: 'handler',
      environment: {
        CONFIG_BUCKET_NAME: this.configBucket.bucketName,
        APPSYNC_API_ID: this.appSyncApi.apiId,
      },
      timeout: cdk.Duration.minutes(5),
    });

    // Lambda authorizer for API Gateway
    const authorizerFunction = new NodejsFunction(this, 'AuthorizerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/lambdas/authorizer/index.ts',
      handler: 'handler',
      environment: {
        API_KEYS_TABLE_NAME: apiKeysTable.tableName,
        SECRET_NAME: apiKeySecret.secretName,
      },
      timeout: cdk.Duration.seconds(10),
      bundling: {
        externalModules: ['aws-sdk'],
        minify: true,
      },
    });

    // SDK configuration Lambda
    const sdkConfigFunction = new NodejsFunction(this, 'SdkConfigFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/lambdas/sdk-config/index.ts',
      handler: 'handler',
      environment: {
        APPSYNC_API_ID: this.appSyncApi.apiId,
      },
      timeout: cdk.Duration.seconds(10),
    });

    // ========================================
    // PERMISSIONS
    // ========================================

    // Grant DynamoDB permissions
    tablesTable.grantReadWriteData(tableManagementFunction);
    tablesTable.grantReadData(recordsManagementFunction);
    apiKeysTable.grantReadWriteData(apiKeyManagementFunction);
    apiKeysTable.grantReadData(authorizerFunction);

    // Grant S3 permissions
    this.configBucket.grantReadWrite(tableManagementFunction);
    this.configBucket.grantRead(schemaSyncFunction);

    // Grant Secrets Manager permissions
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
      ],
      resources: [this.appSyncApi.arn, `${this.appSyncApi.arn}/*`],
    });

    tableManagementFunction.addToRolePolicy(appSyncPolicy);
    schemaSyncFunction.addToRolePolicy(appSyncPolicy);

    // Grant SDK config function permissions to read AppSync API keys
    const appSyncReadPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'appsync:ListApiKeys',
        'appsync:GetGraphqlApi',
      ],
      resources: [this.appSyncApi.arn],
    });

    sdkConfigFunction.addToRolePolicy(appSyncReadPolicy);

    // ========================================
    // API GATEWAY
    // ========================================

    // Lambda authorizer
    const authorizer = new apigateway.RequestAuthorizer(this, 'RdbAuthorizer', {
      handler: authorizerFunction,
      identitySources: [apigateway.IdentitySource.header('x-api-key')],
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    // API Gateway
    this.api = new apigateway.RestApi(this, 'RdbApi', {
      restApiName: 'rdb-api',
      description: 'Realtime Database API',
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
