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
import { z } from 'zod';
import { 
  RdbConfig, 
  InternalConfig,
  TableConfig,
  TableField,
  QueryOptions,
  SubscriptionOptions,
  PaginatedResponse,
  ApiResponse
} from './types';
import { 
  createTableConfigFromSchema, 
  InferSchemaType,
  inferSchemaFromTableMetadata
} from './utils/zod-schema';

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
          async (error: any) => {
            console.warn('error: ', await error.response.json());
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

    // https://github.com/awslabs/aws-mobile-appsync-sdk-js
    
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
   * Get a table instance with Zod schema validation and automatic type inference
   * @template T The Zod schema type
   * @param tableName The name of the table
   * @param schema The Zod schema for validation and type inference
   * @returns A typed table instance with Zod validation
   * 
   * @example
   * ```typescript
   * import { z } from 'zod';
   * 
   * const UserSchema = z.object({
   *   name: z.string().min(1),
   *   email: z.string().email(),
   *   age: z.number().int().min(0),
   *   isActive: z.boolean().default(true)
   * });
   * 
   * const users = client.tableWithSchema('users', UserSchema);
   * // All operations are now typed and validated automatically
   * const user = await users.create({ name: 'John', email: 'john@example.com', age: 30 });
   * // user is typed as ApiResponse<InferSchemaType<typeof UserSchema>>
   * ```
   */
  tableWithSchema<T extends z.ZodRawShape>(
    tableName: string, 
    schema: z.ZodObject<T>
  ): RdbTable<InferSchemaType<z.ZodObject<T>>> {
    const table = new RdbTable<InferSchemaType<z.ZodObject<T>>>(this, tableName);
    // Add schema validation to the table instance
    (table as any)._schema = schema;
    return table;
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
      // Handle both network errors and API errors
      let errorMessage = 'Unknown error';
      try {
        if (error.response) {
          const errorData = await error.response.json();
          errorMessage = errorData.error || errorData.message || error.message;
        } else {
          errorMessage = error.message;
        }
      } catch {
        errorMessage = error.message || 'Network error';
      }
      throw new Error(`Failed to create table: ${errorMessage}`);
    }
  }

  /**
   * Create a new table from a Zod schema with automatic type inference
   * @template T The Zod schema type
   * @param tableName The name of the table to create
   * @param schema The Zod schema defining the table structure
   * @param options Additional options for table creation
   * @returns Promise resolving to table creation result
   * 
   * @example
   * ```typescript
   * import { z } from 'zod';
   * 
   * const UserSchema = z.object({
   *   name: z.string().min(1),
   *   email: z.string().email(),
   *   age: z.number().int().min(0),
   *   isActive: z.boolean().default(true)
   * });
   * 
   * const result = await client.createTableFromSchema('users', UserSchema, {
   *   description: 'User management table'
   * });
   * ```
   */
  async createTableFromSchema<T extends z.ZodRawShape>(
    tableName: string,
    schema: z.ZodObject<T>,
    options: {
      description?: string;
      subscriptions?: Array<{ 
        event: 'create' | 'update' | 'delete' | 'change'; 
        filters?: Array<{ field: string; type: string; operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains'; value?: any }> 
      }>;
    } = {}
  ): Promise<ApiResponse> {
    const tableConfig = createTableConfigFromSchema(tableName, schema, options);
    return this.createTable(tableConfig);
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
   * Get detailed table metadata including field definitions and types
   * @param tableName The name of the table to get metadata for
   * @returns Promise resolving to table metadata with field information
   * 
   * @example
   * ```typescript
   * const metadata = await client.getTableMetadata('users');
   * console.log('Table fields:', metadata.fields);
   * ```
   */
  async getTableMetadata(tableName: string): Promise<{
    tableName: string;
    fields: TableField[];
    description?: string;
    graphqlTypeName?: string;
  }> {
    try {
      // First try to get from the listTables response which includes full metadata
      const tablesResponse = await this.listTables();
      if (tablesResponse.success && tablesResponse.data?.items) {
        const table = tablesResponse.data.items.find(t => t.tableName === tableName);
        if (table) {
          const result: {
            tableName: string;
            fields: TableField[];
            description?: string;
            graphqlTypeName?: string;
          } = {
            tableName: table.tableName,
            fields: table.fields,
          };
          if (table.description) result.description = table.description;
          if (table.graphqlTypeName) result.graphqlTypeName = table.graphqlTypeName;
          return result;
        }
      }
      
      // Fallback to individual table schema endpoint
      const schemaResponse = await this.getTableSchema(tableName);
      
      // Convert the simplified schema format to TableField format
      const fields: TableField[] = Object.entries(schemaResponse.fields).map(([name, type]) => ({
        name,
        type: type as any, // Type assertion since we know the backend types
        required: true, // Default assumption
        indexed: false, // Default assumption
        primary: name === 'id'
      }));
      
      return {
        tableName,
        fields,
        description: `Table: ${tableName}`
      };
    } catch (error: any) {
      throw new Error(`Failed to get table metadata: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Automatically infer a Zod schema from an existing table's metadata
   * This enables reading from tables with automatic type safety
   * @param tableName The name of the table to infer schema from
   * @returns Promise resolving to an inferred Zod schema and table information
   * 
   * @example
   * ```typescript
   * // Automatically infer schema from existing table
   * const { schema, tableName: name } = await client.inferTableSchema('users');
   * 
   * // Use the inferred schema to create a typed table instance
   * const users = client.tableWithSchema(name, schema);
   * 
   * // Now you have full type safety and validation
   * const usersList = await users.list();
   * ```
   */
  async inferTableSchema(tableName: string): Promise<{
    schema: z.ZodObject<any>;
    tableName: string;
    description?: string;
  }> {
    const metadata = await this.getTableMetadata(tableName);
    return inferSchemaFromTableMetadata(metadata);
  }

  /**
   * Create a typed table instance with automatic schema inference from existing table
   * This is a convenience method that combines getTableMetadata and tableWithSchema
   * @param tableName The name of the existing table
   * @returns A typed table instance with inferred schema and validation
   * 
   * @example
   * ```typescript
   * // Automatically create typed table from existing table
   * const users = await client.tableWithInferredSchema('users');
   * 
   * // Full type safety without manually defining schemas
   * const newUser = await users.create({
   *   name: 'John Doe',
   *   email: 'john@example.com'
   * }); // Automatic validation based on existing table structure
   * ```
   */
  async tableWithInferredSchema(tableName: string): Promise<RdbTable<any>> {
    const { schema } = await this.inferTableSchema(tableName);
    return this.tableWithSchema(tableName, schema);
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
      // If this table has a schema attached, validate the data
      if ((this as any)._schema) {
        try {
          (this as any)._schema.parse(data);
        } catch (validationError: any) {
          throw new Error(`Validation failed: ${validationError.message}`);
        }
      }

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
   *   filters: { chatId: 'room123' }, // Dynamic runtime filters
   *   onData: (user: User) => console.log('User changed:', user)
   * });
   * const observable = await subscription.connect();
   * ```
   */
  async connect(): Promise<Observable<T>> {
    // Get table metadata to fetch the GraphQL type name and subscription config
    let graphqlTypeName: string;
    let fields: string[] = []; // We'll get fields from schema
    let subscriptions: any[] = [];
    
    try {
      const tablesResponse = await this.client.listTables();
      if (tablesResponse.success && tablesResponse.data?.items) {
        const table = tablesResponse.data.items.find(t => t.tableName === this.tableName);
        if (table) {
          // Use the stored GraphQL type name if available
          graphqlTypeName = table.graphqlTypeName || this.capitalize(this.tableName);
          
          // Extract field names from metadata
          if (table.fields && table.fields.length > 0) {
            fields = table.fields.map(f => f.name);
          }
          
          // Get subscription configuration with filter definitions
          subscriptions = table.subscriptions || [];
        } else {
          throw new Error(`Table ${this.tableName} not found`);
        }
      } else {
        throw new Error('Failed to fetch table metadata');
      }
    } catch (error) {
      console.warn(`Could not fetch metadata for ${this.tableName}, using fallback:`, error);
      graphqlTypeName = this.capitalize(this.tableName);
      fields = ['name', 'email', 'age', 'active'];
    }
    
    // Build GraphQL subscription query with dynamic fields and filter arguments
    const fieldsQuery = fields.join('\n          ');
    
    // Build filter arguments from the subscription configuration
    const filterArgs: string[] = [];
    const filterVariables: { [key: string]: any } = {};
    
    // Find the 'create' subscription configuration to get filter definitions
    const createSubscription = subscriptions.find((sub: any) => sub.event === 'create');
    
    if (createSubscription && createSubscription.filters) {
      // Use filters from subscription configuration
      createSubscription.filters.forEach((filter: any) => {
        const fieldName = filter.field;
        const fieldType = filter.type;
        
        // Map backend types to GraphQL types
        let gqlType = 'String';
        if (fieldType === 'Boolean') gqlType = 'Boolean';
        else if (fieldType === 'Int') gqlType = 'Int';
        else if (fieldType === 'Float') gqlType = 'Float';
        
        filterArgs.push(`$${fieldName}: ${gqlType}`);
        
        // Use runtime filter value if provided, otherwise undefined (optional)
        if (this.options.filters && this.options.filters[fieldName] !== undefined) {
          filterVariables[fieldName] = this.options.filters[fieldName];
        }
      });
    } else if (this.options.filters) {
      // Fallback: infer from runtime filters if no subscription config
      Object.keys(this.options.filters).forEach(key => {
        const value = this.options.filters![key];
        let gqlType = 'String';
        
        if (typeof value === 'boolean') gqlType = 'Boolean';
        else if (typeof value === 'number') gqlType = Number.isInteger(value) ? 'Int' : 'Float';
        
        filterArgs.push(`$${key}: ${gqlType}`);
        filterVariables[key] = value;
      });
    }
    
    // Build the argument list for the subscription field
    // Include all filter arguments defined in the schema, passing variables
    const subscriptionFieldArgs = filterArgs.length > 0
      ? `(${filterArgs
          .filter((arg): arg is string => typeof arg === 'string' && arg.trim().length > 0)
          .map(arg => {
            const parts = arg.split(':');
            const varName = parts[0]?.trim().substring(1); // Extract variable name without $
            return `${varName}: $${varName}`;
          })
          .join(', ')})`
      : '';
    
    // Build the subscription query - subscribing to Create events with filters
    const variableDefinitions = filterArgs.length > 0 ? `(${filterArgs.join(', ')})` : '';
    
    const subscriptionQuery = gql`
      subscription On${graphqlTypeName}Create${variableDefinitions} {
        on${graphqlTypeName}Create${subscriptionFieldArgs} {
          ${fieldsQuery}
        }
      }
    `;

    console.log('[RDB] Subscription query:', subscriptionQuery.loc?.source.body);
    console.log('[RDB] Subscription variables:', filterVariables);

    // Create Apollo subscription with runtime filter values
    this.subscription = this.apolloClient.subscribe({
      query: subscriptionQuery,
      variables: filterVariables,
    });

    // Set up subscription handlers with type safety
    this.subscription.subscribe({
      next: (result: any) => {
        if (this.options.onData && result.data) {
          // Try all possible subscription field names
          const typedData: T = result.data[`on${graphqlTypeName}Create`] 
            || result.data[`on${graphqlTypeName}Update`] 
            || result.data[`on${graphqlTypeName}Delete`];
          
          if (typedData) {
            this.options.onData(typedData);
          }
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

// Export types and utilities for external use
export type { 
  RdbConfig, 
  TableConfig, 
  QueryOptions, 
  SubscriptionOptions, 
  PaginatedResponse, 
  ApiResponse,
  TableField
} from './types';

export {
  zodSchemaToFields,
  createTableConfigFromSchema,
  validateDataWithSchema,
  validatePartialDataWithSchema
} from './utils/zod-schema';

export type { InferSchemaType } from './utils/zod-schema';

// Re-export Zod for consistent version usage
export { z } from 'zod';