import ky, { KyInstance } from 'ky';
import { AUTH_TYPE, createAuthLink } from 'aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from 'aws-appsync-subscription-link';
import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  from,
  gql,
  Observable,
} from '@apollo/client';
import { 
  RdbConfig, 
  TableConfig, 
  QueryOptions,
  SubscriptionOptions,
  PaginatedResponse,
  ApiResponse
} from '../types';

// Apollo client instance - will be initialized per RDB client
const apolloClientInstances = new Map<string, ApolloClient<any>>();

export class RdbClient {
  private apiClient: KyInstance;
  private apolloClient: ApolloClient<any> | null = null;
  private config: RdbConfig;
  private clientId: string;

  constructor(config: RdbConfig) {
    this.config = config;
    this.clientId = `${config.endpoint}-${config.apiKey.substring(0, 8)}`;
    
    // Initialize HTTP client with ky
    this.apiClient = ky.create({
      prefixUrl: config.endpoint,
      headers: {
        'X-Api-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      retry: {
        limit: 3,
        methods: ['get'],
        statusCodes: [408, 413, 429, 500, 502, 503, 504],
      },
      hooks: {
        beforeError: [
          (error: any) => {
            const { response } = error;
            if (response && response.body) {
              error.name = 'RdbApiError';
              error.message = `${response.status} ${response.statusText}: ${response.body}`;
            }
            return error;
          },
        ],
      },
    });

    // Initialize Apollo client for GraphQL subscriptions if AppSync config is provided
    if (config.appSyncEndpoint && config.appSyncRegion) {
      this.initializeApolloClient();
    }
  }

  /**
   * Initialize Apollo client for AppSync GraphQL subscriptions
   */
  private initializeApolloClient(): void {
    if (apolloClientInstances.has(this.clientId)) {
      this.apolloClient = apolloClientInstances.get(this.clientId)!;
      return;
    }

    const { appSyncEndpoint, appSyncRegion, appSyncApiKey } = this.config;

    if (!appSyncEndpoint || !appSyncRegion || !appSyncApiKey) {
      console.warn('[RDB] AppSync configuration incomplete. Subscriptions will not be available.');
      return;
    }

    const auth = {
      type: 'API_KEY' as const,
      apiKey: appSyncApiKey,
    };

    const httpLink = new HttpLink({ uri: appSyncEndpoint });

    const link = from([
      createAuthLink({ url: appSyncEndpoint, region: appSyncRegion, auth }),
      createSubscriptionHandshakeLink({ url: appSyncEndpoint, region: appSyncRegion, auth }, httpLink),
    ]);

    this.apolloClient = new ApolloClient({
      link,
      cache: new InMemoryCache({
        typePolicies: {
          Query: {
            fields: {
              // Add any custom field policies here
            },
          },
        },
      }),
      defaultOptions: {
        watchQuery: {
          errorPolicy: 'all',
        },
        query: {
          errorPolicy: 'all',
        },
        mutate: {
          errorPolicy: 'all',
        },
      },
    });

    apolloClientInstances.set(this.clientId, this.apolloClient);
    console.log('[RDB] Apollo client initialized successfully');
  }

  /**
   * Get a table instance for operations
   */
  table(tableName: string): RdbTable {
    return new RdbTable(this, tableName);
  }

  /**
   * Create a new table
   */
  async createTable(config: TableConfig): Promise<ApiResponse> {
    try {
      const response = await this.apiClient.post('tables', { json: config }).json<ApiResponse>();
      return response;
    } catch (error: any) {
      throw new Error(`Failed to create table: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * List all tables
   */
  async listTables(): Promise<ApiResponse<PaginatedResponse<TableConfig>>> {
    try {
      const response = await this.apiClient.get('tables').json<ApiResponse<PaginatedResponse<TableConfig>>>();
      return response;
    } catch (error: any) {
      throw new Error(`Failed to list tables: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Update a table
   */
  async updateTable(tableName: string, updates: Partial<TableConfig>): Promise<ApiResponse> {
    try {
      const response = await this.apiClient.put(`tables/${tableName}`, { json: updates }).json<ApiResponse>();
      return response;
    } catch (error: any) {
      throw new Error(`Failed to update table: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Delete a table
   */
  async deleteTable(tableName: string): Promise<ApiResponse> {
    try {
      const response = await this.apiClient.delete(`tables/${tableName}`).json<ApiResponse>();
      return response;
    } catch (error: any) {
      throw new Error(`Failed to delete table: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Get table schema including field definitions
   */
  async getTableSchema(tableName: string): Promise<{ fields: { [key: string]: string } }> {
    try {
      const response = await this.apiClient.get(`tables/${tableName}/schema`).json<{ fields: { [key: string]: string } }>();
      return response;
    } catch (error: any) {
      throw new Error(`Failed to get table schema: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Internal method to get API client
   */
  getApiClient(): KyInstance {
    return this.apiClient;
  }

  /**
   * Internal method to get Apollo client
   */
  getApolloClient(): ApolloClient<any> | null {
    return this.apolloClient;
  }

  /**
   * Get configuration
   */
  getConfig(): RdbConfig {
    return this.config;
  }
}

export class RdbTable {
  private client: RdbClient;
  private tableName: string;

  constructor(client: RdbClient, tableName: string) {
    this.client = client;
    this.tableName = tableName;
  }

  /**
   * Create a record in the table
   */
  async create(data: any): Promise<ApiResponse> {
    try {
      const response = await this.client.getApiClient()
        .post(`tables/${this.tableName}/records`, { json: data })
        .json<ApiResponse>();
      return response;
    } catch (error: any) {
      throw new Error(`Failed to create record: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * List records in the table
   */
  async list(options?: QueryOptions): Promise<ApiResponse<PaginatedResponse<any>>> {
    try {
      const searchParams = new URLSearchParams();
      if (options?.limit) searchParams.set('limit', options.limit.toString());
      if (options?.nextToken) searchParams.set('nextToken', options.nextToken);
      
      const response = await this.client.getApiClient()
        .get(`tables/${this.tableName}/records`, { searchParams })
        .json<ApiResponse<PaginatedResponse<any>>>();
      return response;
    } catch (error: any) {
      throw new Error(`Failed to list records: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Delete a record from the table
   */
  async delete(recordId: string): Promise<ApiResponse> {
    try {
      const response = await this.client.getApiClient()
        .delete(`tables/${this.tableName}/records/${recordId}`)
        .json<ApiResponse>();
      return response;
    } catch (error: any) {
      throw new Error(`Failed to delete record: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Subscribe to real-time updates for this table
   */
  subscribe(options: SubscriptionOptions = {}): RdbSubscription {
    const apolloClient = this.client.getApolloClient();
    
    if (!apolloClient) {
      throw new Error('AppSync is not configured. Cannot create subscriptions.');
    }

    return new RdbSubscription(apolloClient, this.tableName, options, this.client);
  }
}

export class RdbSubscription {
  private apolloClient: ApolloClient<any>;
  private tableName: string;
  private options: SubscriptionOptions;
  private subscription: any = null;
  private client: RdbClient;

  constructor(apolloClient: ApolloClient<any>, tableName: string, options: SubscriptionOptions, client: RdbClient) {
    this.apolloClient = apolloClient;
    this.tableName = tableName;
    this.options = options;
    this.client = client;
  }

  /**
   * Start the subscription
   */
  async connect(): Promise<Observable<any>> {
    const typeName = this.capitalize(this.tableName);
    
    // Get table schema to generate dynamic fields
    let fields: string[] = ['id', 'createdAt', 'updatedAt']; // Default fields
    
    try {
      const schema = await this.client.getTableSchema(this.tableName);
      if (schema.fields) {
        // Add all schema fields to the subscription
        const schemaFields = Object.keys(schema.fields).filter(
          field => !['id', 'createdAt', 'updatedAt'].includes(field)
        );
        fields = [...fields, ...schemaFields];
      }
    } catch (error) {
      console.warn(`Could not fetch schema for ${this.tableName}, using default fields:`, error);
    }
    
    // Build GraphQL subscription query with dynamic fields
    const fieldsQuery = fields.join('\n          ');
    const subscriptionQuery = gql`
      subscription On${typeName}Change($filters: ${typeName}FilterInput) {
        on${typeName}Change(filters: $filters) {
          ${fieldsQuery}
        }
      }
    `;

    // Create Apollo subscription
    this.subscription = this.apolloClient.subscribe({
      query: subscriptionQuery,
      variables: {
        filters: this.options.filters || {},
      },
    });

    // Set up subscription handlers
    this.subscription.subscribe({
      next: (result: any) => {
        if (this.options.onData && result.data) {
          this.options.onData(result.data[`on${typeName}Change`]);
        }
      },
      error: (error: any) => {
        console.error(`Subscription error for ${this.tableName}:`, error);
        if (this.options.onError) {
          this.options.onError(error);
        }
      },
      complete: () => {
        console.log(`Subscription completed for ${this.tableName}`);
        if (this.options.onComplete) {
          this.options.onComplete();
        }
      },
    });

    return this.subscription;
  }

  /**
   * Disconnect the subscription
   */
  disconnect(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  /**
   * Utility method to capitalize strings
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

/**
 * Create API key
 */
export async function createApiKey(
  endpoint: string,
  name: string,
  description?: string
): Promise<{ apiKey: string; apiKeyId: string }> {
  try {
    const response = await ky.post(`${endpoint}/api-keys`, {
      json: {
        name,
        description,
      },
    }).json<{ apiKey: string; apiKeyId: string }>();
    
    return response;
  } catch (error: any) {
    throw new Error(`Failed to create API key: ${error.message}`);
  }
}