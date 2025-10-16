import ky, { KyInstance } from 'ky';
import { createAuthLink } from 'aws-appsync-auth-link';
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
  InternalConfig,
  TableConfig, 
  QueryOptions,
  SubscriptionOptions,
  PaginatedResponse,
  ApiResponse
} from './types';

// Apollo client instance - will be initialized per RDB client
const apolloClientInstances = new Map<string, ApolloClient<any>>();

export class RdbClient {
  private apiClient: KyInstance;
  private apolloClient: ApolloClient<any> | null = null;
  private config: InternalConfig;
  private clientId: string;
  private configPromise: Promise<InternalConfig> | null = null;

  constructor(config: RdbConfig) {
    this.config = { ...config } as InternalConfig;
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

    // Don't initialize Apollo client immediately - it will be initialized when needed
  }

  /**
   * Fetch SDK configuration from the API endpoint
   * This includes AppSync endpoint, region, and API key for real-time subscriptions
   */
  private async fetchSdkConfig(): Promise<InternalConfig> {
    try {
      // Check if we have cached config that's still valid
      if (this.config.configFetchedAt && this.config.configTtl) {
        const configAge = (Date.now() - this.config.configFetchedAt) / 1000;
        if (configAge < this.config.configTtl) {
          return this.config;
        }
      }

      const response = await this.apiClient.get('sdk/config').json<{
        appSync: {
          endpoint: string;
          region: string;
          apiKey: string;
        };
        ttl?: number;
      }>();

      // Update internal config with fetched AppSync details
      this.config = {
        ...this.config,
        appSyncEndpoint: response.appSync.endpoint,
        appSyncRegion: response.appSync.region,
        appSyncApiKey: response.appSync.apiKey,
        configFetchedAt: Date.now(),
        configTtl: response.ttl || 3600, // Default 1 hour TTL
      };

      return this.config;
    } catch (error: any) {
      console.warn('[RDB] Failed to fetch SDK configuration. Real-time features will not be available.', error.message);
      return this.config;
    }
  }

  /**
   * Ensure SDK configuration is available, fetching it if necessary
   */
  private async ensureConfig(): Promise<InternalConfig> {
    if (!this.config.disableRealtime && !this.config.appSyncEndpoint) {
      if (!this.configPromise) {
        this.configPromise = this.fetchSdkConfig();
      }
      return this.configPromise;
    }
    return this.config;
  }

  /**
   * Initialize Apollo client for AppSync GraphQL subscriptions
   */
  private async initializeApolloClient(): Promise<void> {
    if (apolloClientInstances.has(this.clientId)) {
      this.apolloClient = apolloClientInstances.get(this.clientId)!;
      return;
    }

    // Ensure we have the configuration
    await this.ensureConfig();
    
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
   * Get a table instance for operations with type inference
   * @template T The type of records in this table
   * @param tableName The name of the table
   * @returns A typed table instance
   * 
   * @example
   * ```typescript
   * interface User {
   *   id?: string;
   *   name: string;
   *   email: string;
   *   age: number;
   * }
   * 
   * const users = client.table<User>('users');
   * const user = await users.create({ name: 'John', email: 'john@example.com', age: 30 });
   * // user is now typed as ApiResponse<User>
   * ```
   */
  table<T = any>(tableName: string): RdbTable<T> {
    return new RdbTable<T>(this, tableName);
  }

  /**
   * Create a new table
   */
  async createTable(config: TableConfig): Promise<ApiResponse> {
    try {
      const response = await this.apiClient.post('tables', { json: config }).json<{ message: string, table: any }>();
      // Transform backend response to match SDK expectations
      return {
        success: true,
        message: response.message,
        data: response.table
      };
    } catch (error: any) {
      throw new Error(`Failed to create table: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * List all tables with full type information
   * @returns Promise resolving to paginated list of table configurations
   * 
   * @example
   * ```typescript
   * const result = await client.listTables();
   * if (result.success) {
   *   console.log('Tables:', result.data?.items.map(t => t.tableName));
   * }
   * ```
   */
  async listTables(): Promise<ApiResponse<PaginatedResponse<TableConfig>>> {
    try {
      const response = await this.apiClient.get('tables').json<{ tables: TableConfig[], count: number }>();
      // Transform backend response to match SDK expectations
      return {
        success: true,
        data: {
          items: response.tables,
          count: response.count
        }
      };
    } catch (error: any) {
      throw new Error(`Failed to list tables: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Update a table
   */
  async updateTable(tableName: string, updates: Partial<TableConfig>): Promise<ApiResponse> {
    try {
      const response = await this.apiClient.put(`tables/${tableName}`, { json: updates }).json<{ message: string }>();
      // Transform backend response to match SDK expectations
      return {
        success: true,
        message: response.message
      };
    } catch (error: any) {
      throw new Error(`Failed to update table: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Delete a table
   */
  async deleteTable(tableName: string): Promise<ApiResponse> {
    try {
      const response = await this.apiClient.delete(`tables/${tableName}`).json<{ message: string }>();
      // Transform backend response to match SDK expectations
      return {
        success: true,
        message: response.message
      };
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
  async getApolloClient(): Promise<ApolloClient<any> | null> {
    if (!this.config.disableRealtime) {
      await this.initializeApolloClient();
    }
    return this.apolloClient;
  }

  /**
   * Get configuration
   */
  getConfig(): RdbConfig {
    return this.config;
  }
}

export class RdbTable<T = any> {
  private client: RdbClient;
  private tableName: string;

  constructor(client: RdbClient, tableName: string) {
    this.client = client;
    this.tableName = tableName;
  }

  /**
   * Create a record in the table
   * @param data The record data to create
   * @returns Promise resolving to the created record with full type safety
   * 
   * @example
   * ```typescript
   * interface User {
   *   id?: string;
   *   name: string;
   *   email: string;
   * }
   * 
   * const users = client.table<User>('users');
   * const result = await users.create({ name: 'John', email: 'john@example.com' });
   * // result.data is typed as User
   * ```
   */
  async create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiResponse<T>> {
    try {
      // Backend returns { success: true, message: string, data: record }
      const response = await this.client.getApiClient()
        .post(`tables/${this.tableName}/records`, { json: data })
        .json<{ success: boolean, message: string, data: T }>();
      return response;
    } catch (error: any) {
      throw new Error(`Failed to create record: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * List records in the table
   * @param options Query options for pagination and filtering
   * @returns Promise resolving to paginated records with full type safety
   * 
   * @example
   * ```typescript
   * interface User {
   *   id: string;
   *   name: string;
   *   email: string;
   * }
   * 
   * const users = client.table<User>('users');
   * const result = await users.list({ limit: 10 });
   * // result.data.items is typed as User[]
   * ```
   */
  async list(options?: QueryOptions): Promise<ApiResponse<PaginatedResponse<T>>> {
    try {
      const searchParams = new URLSearchParams();
      if (options?.limit) searchParams.set('limit', options.limit.toString());
      if (options?.nextToken) searchParams.set('nextToken', options.nextToken);
      
      // Backend returns { success: true, data: { items: T[], count: number, nextToken?: string } }
      const response = await this.client.getApiClient()
        .get(`tables/${this.tableName}/records`, { searchParams })
        .json<{ success: boolean, data: { items: T[], count: number, nextToken?: string } }>();
      return response;
    } catch (error: any) {
      throw new Error(`Failed to list records: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Get a single record by ID (convenience method that filters the list)
   * @param recordId The ID of the record to retrieve
   * @returns Promise resolving to the record or null if not found
   * 
   * @example
   * ```typescript
   * interface User {
   *   id: string;
   *   name: string;
   * }
   * 
   * const users = client.table<User>('users');
   * const user = await users.get('user-123');
   * // user is typed as ApiResponse<User | null>
   * ```
   */
  async get(recordId: string): Promise<ApiResponse<T | null>> {
    try {
      // Since there's no direct GET endpoint, we'll list and filter
      const response = await this.list({ limit: 1 });
      if (response.success && response.data?.items) {
        // Find the record with matching ID
        const record = response.data.items.find((item: any) => 
          item.id === recordId || 
          Object.values(item).includes(recordId)
        );
        
        return {
          success: true,
          data: record || null
        };
      }
      
      return {
        success: true,
        data: null
      };
    } catch (error: any) {
      throw new Error(`Failed to get record: ${error.message}`);
    }
  }

  /**
   * Create multiple records (batch operation using individual creates)
   * @param records Array of records to create
   * @returns Promise resolving to array of created records
   * 
   * @example
   * ```typescript
   * const users = client.table<User>('users');
   * const results = await users.createMany([
   *   { name: 'John', email: 'john@example.com' },
   *   { name: 'Jane', email: 'jane@example.com' }
   * ]);
   * // results is typed as ApiResponse<T>[]
   * ```
   */
  async createMany(records: Omit<T, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<ApiResponse<T>[]> {
    const results: ApiResponse<T>[] = [];
    
    for (const record of records) {
      try {
        const result = await this.create(record);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    return results;
  }

  /**
   * Delete a record from the table
   * @param recordId The ID of the record to delete
   * @returns Promise resolving to deletion confirmation
   */
  async delete(recordId: string): Promise<ApiResponse> {
    try {
      // Backend returns { success: true, message: string }
      const response = await this.client.getApiClient()
        .delete(`tables/${this.tableName}/records/${recordId}`)
        .json<{ success: boolean, message: string }>();
      return response;
    } catch (error: any) {
      throw new Error(`Failed to delete record: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Count total records in the table (using list with limit 1)
   * @returns Promise resolving to the total count
   * 
   * @example
   * ```typescript
   * const users = client.table<User>('users');
   * const result = await users.count();
   * // result.data contains the count
   * ```
   */
  async count(): Promise<ApiResponse<number>> {
    try {
      const response = await this.list({ limit: 1 });
      const result: ApiResponse<number> = {
        success: response.success,
        data: response.data?.count || 0
      };
      if (response.message) {
        result.message = response.message;
      }
      return result;
    } catch (error: any) {
      throw new Error(`Failed to count records: ${error.message}`);
    }
  }

  /**
   * Subscribe to real-time updates for this table
   * @param options Subscription options with typed event handlers
   * @returns Promise resolving to a typed subscription instance
   * 
   * @example
   * ```typescript
   * interface User {
   *   id: string;
   *   name: string;
   *   email: string;
   * }
   * 
   * const users = client.table<User>('users');
   * const subscription = await users.subscribe({
   *   onData: (user: User) => {
   *     console.log('User updated:', user.name, user.email);
   *   },
   *   onError: (error) => console.error('Subscription error:', error)
   * });
   * ```
   */
  async subscribe(options: SubscriptionOptions<T> = {}): Promise<RdbSubscription<T>> {
    const apolloClient = await this.client.getApolloClient();
    
    if (!apolloClient) {
      throw new Error('AppSync is not configured or real-time features are disabled. Cannot create subscriptions.');
    }

    return new RdbSubscription<T>(apolloClient, this.tableName, options, this.client);
  }
}

export class RdbSubscription<T = any> {
  private apolloClient: ApolloClient<any>;
  private tableName: string;
  private options: SubscriptionOptions<T>;
  private subscription: any = null;
  private client: RdbClient;

  constructor(apolloClient: ApolloClient<any>, tableName: string, options: SubscriptionOptions<T>, client: RdbClient) {
    this.apolloClient = apolloClient;
    this.tableName = tableName;
    this.options = options;
    this.client = client;
  }

  /**
   * Start the subscription with full type safety
   * @returns Promise resolving to an Observable of typed subscription data
   * 
   * @example
   * ```typescript
   * const subscription = await users.subscribe({
   *   onData: (user: User) => console.log('User changed:', user)
   * });
   * const observable = await subscription.connect();
   * ```
   */
  async connect(): Promise<Observable<T>> {
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

    // Set up subscription handlers with type safety
    this.subscription.subscribe({
      next: (result: any) => {
        if (this.options.onData && result.data) {
          const typedData: T = result.data[`on${typeName}Change`];
          this.options.onData(typedData);
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