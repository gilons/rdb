import ky, { KyInstance } from 'ky';
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

// WebSocket polyfill for Node.js
let WebSocket: any;
try {
  // Try to detect environment and load appropriate WebSocket
  if (typeof globalThis !== 'undefined' && globalThis.WebSocket) {
    WebSocket = globalThis.WebSocket;
  } else if (typeof global !== 'undefined' && !(global as any).WebSocket) {
    // Node.js environment - try to load ws package
    WebSocket = require('ws');
  } else {
    WebSocket = (global as any).WebSocket || (globalThis as any).WebSocket;
  }
} catch (error) {
  console.warn('[RDB] WebSocket not available. Install "ws" package for Node.js support.');
}

// Real-time subscription message types
interface RealtimeMessage {
  id?: string;
  type: 'connection_init' | 'connection_ack' | 'connection_error' | 'start' | 'data' | 'error' | 'complete' | 'stop';
  payload?: any;
}

interface SubscriptionHandler<T> {
  id: string;
  query: string;
  variables: Record<string, any>;
  onData?: (data: T) => void;
  onError?: (error: any) => void;
  onComplete?: () => void;
}

/**
 * Custom WebSocket client for real-time subscriptions
 * Implements the real-time protocol for GraphQL subscriptions
 */
class RealtimeClient {
  private ws: any = null;
  private url: string;
  private apiKey: string;
  private subscriptions = new Map<string, SubscriptionHandler<any>>();
  private connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second

  constructor(url: string, apiKey: string) {
    this.url = url;
    this.apiKey = apiKey;
  }

  /**
   * Connect to real-time WebSocket
   */
  async connect(): Promise<void> {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.connectionState = 'connecting';
        
        // Convert HTTP URL to WebSocket URL
        let baseUrl = this.url
          .replace(/^https?:/, 'wss:')
          .replace(/\.appsync-api\./, '.appsync-realtime-api.');
        
        // Ensure it ends with /graphql (not /graphql/realtime for query parameter approach)
        if (!baseUrl.endsWith('/graphql')) {
          baseUrl = baseUrl.replace(/\/$/, '') + '/graphql';
        }
        
        // Create header object for API key authentication
        const host = new URL(this.url).host;
        const headerObj = {
          host: host,
          'x-api-key': this.apiKey
        };
        
        // Base64 encode the header and payload
        const encodedHeader = this.base64Encode(JSON.stringify(headerObj));
        const encodedPayload = this.base64Encode('{}');
        
        // Add query parameters for authentication
        const wsUrl = `${baseUrl}?header=${encodeURIComponent(encodedHeader)}&payload=${encodeURIComponent(encodedPayload)}`;
        
        console.log('[RDB] Connecting to real-time WebSocket with auth params');
        
        // Create WebSocket connection with GraphQL subprotocols
        this.ws = new WebSocket(wsUrl, ['graphql-ws']);

        this.ws.onopen = () => {
          console.log('[RDB] Real-time WebSocket connected');
          
          // Send connection_init (no auth needed here, it's in the URL)
          this.send({
            type: 'connection_init'
          });
        };

        this.ws.onmessage = (event: any) => {
          try {
            const message: RealtimeMessage = JSON.parse(event.data);
            console.log('[RDB] Received message:', message);
            this.handleMessage(message);
            
            if (message.type === 'connection_ack') {
              this.connectionState = 'connected';
              this.reconnectAttempts = 0;
              console.log('[RDB] Real-time WebSocket connection acknowledged');
              resolve();
            } else if (message.type === 'connection_error') {
              console.error('[RDB] Real-time connection error:', message.payload);
              reject(new Error(JSON.stringify(message.payload)));
            }
          } catch (error) {
            console.error('[RDB] Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onclose = (event: any) => {
          console.log('[RDB] Real-time WebSocket closed:', event.code, event.reason);
          this.connectionState = 'disconnected';
          
          // Attempt to reconnect if not intentionally closed
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            setTimeout(() => this.reconnect(), this.reconnectDelay * Math.pow(2, this.reconnectAttempts));
          }
        };

        this.ws.onerror = (error: any) => {
          console.error('[RDB] Real-time WebSocket error:', JSON.stringify(error));
          this.connectionState = 'disconnected';
          
          // Try a different approach if the first one fails
          if (this.reconnectAttempts === 0) {
            console.log('[RDB] Trying alternative connection method...');
            this.connectWithAuth().then(resolve).catch(reject);
          } else {
            reject(error);
          }
        };

      } catch (error) {
        this.connectionState = 'disconnected';
        reject(error);
      }
    });
  }

  /**
   * Alternative connection method with authorization headers
   */
  private async connectWithAuth(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // This is actually the same as the primary connection method now
        // Use standard HTTP headers approach (alternative)
        let baseUrl = this.url
          .replace(/^https?:/, 'wss:')
          .replace(/\.appsync-api\./, '.appsync-realtime-api.');
        
        if (!baseUrl.endsWith('/graphql')) {
          baseUrl = baseUrl.replace(/\/$/, '') + '/graphql';
        }
                
        console.log('[RDB] Trying alternative connection method');
        
        this.ws = new WebSocket(baseUrl, ['graphql-ws'], {
          headers: {
            'host': new URL(this.url).host,
            'x-api-key': this.apiKey
          }
        });

        this.ws.onopen = () => {
          console.log('[RDB] Real-time WebSocket connected with auth headers');
          
          // Send connection_init
          this.send({
            type: 'connection_init'
          });
        };

        this.ws.onmessage = (event: any) => {
          try {
            const message: RealtimeMessage = JSON.parse(event.data);
            console.log('[RDB] Received auth message:', message);
            this.handleMessage(message);
            
            if (message.type === 'connection_ack') {
              this.connectionState = 'connected';
              this.reconnectAttempts = 0;
              console.log('[RDB] Real-time WebSocket connection acknowledged with auth');
              resolve();
            } else if (message.type === 'connection_error') {
              console.error('[RDB] Real-time connection error with auth:', message.payload);
              reject(new Error(JSON.stringify(message.payload)));
            }
          } catch (error) {
            console.error('[RDB] Failed to parse WebSocket message with auth:', error);
          }
        };

        this.ws.onclose = (event: any) => {
          console.log('[RDB] Real-time WebSocket with auth closed:', event.code, event.reason);
          this.connectionState = 'disconnected';
        };

        this.ws.onerror = (error: any) => {
          console.error('[RDB] Real-time WebSocket with auth error:', error);
          this.connectionState = 'disconnected';
          reject(error);
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Base64 encode helper
   */
  private base64Encode(str: string): string {
    try {
      // Try Node.js Buffer first
      return Buffer.from(str).toString('base64');
    } catch {
      // Fallback to browser btoa
      return btoa(str);
    }
  }  /**
   * Reconnect with exponential backoff
   */
  private async reconnect(): Promise<void> {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      return;
    }

    this.reconnectAttempts++;
    console.log(`[RDB] Reconnecting to AppSync WebSocket (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    try {
      await this.connect();
      
      // Resubscribe to all active subscriptions
      for (const subscription of this.subscriptions.values()) {
        this.startSubscription(subscription);
      }
    } catch (error) {
      console.error('[RDB] Reconnection failed:', error);
    }
  }

  /**
   * Send message to WebSocket
   */
  private send(message: RealtimeMessage): void {
    if (this.ws && this.ws.readyState === 1) { // OPEN
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: RealtimeMessage): void {
    switch (message.type) {
      case 'connection_ack':
        // Connection acknowledged - handled in onmessage
        break;
        
      case 'data':
        if (message.id && this.subscriptions.has(message.id)) {
          const subscription = this.subscriptions.get(message.id)!;
          if (subscription.onData && message.payload?.data) {
            subscription.onData(message.payload.data);
          }
        }
        break;
        
      case 'error':
        if (message.id && this.subscriptions.has(message.id)) {
          const subscription = this.subscriptions.get(message.id)!;
          if (subscription.onError) {
            subscription.onError(message.payload);
          }
        }
        break;
        
      case 'complete':
        if (message.id && this.subscriptions.has(message.id)) {
          const subscription = this.subscriptions.get(message.id)!;
          if (subscription.onComplete) {
            subscription.onComplete();
          }
          this.subscriptions.delete(message.id);
        }
        break;
        
      default:
        console.log('[RDB] Unknown AppSync message type:', message.type);
    }
  }

  /**
   * Start a GraphQL subscription
   */
  startSubscription(handler: SubscriptionHandler<any>): void {
    this.subscriptions.set(handler.id, handler);
    
    if (this.connectionState === 'connected') {
      console.log('[RDB] Starting subscription:', handler.id);
      this.send({
        id: handler.id,
        type: 'start',
        payload: {
          data: JSON.stringify({
            query: handler.query,
            variables: handler.variables
          }),
          extensions: {
            authorization: {
              'x-api-key': this.apiKey
            }
          }
        }
      });
    } else {
      console.log('[RDB] WebSocket not connected, subscription will start when connected');
    }
  }

  /**
   * Stop a subscription
   */
  stopSubscription(id: string): void {
    if (this.subscriptions.has(id)) {
      this.send({
        id,
        type: 'stop'
      });
      this.subscriptions.delete(id);
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.connectionState = 'disconnected';
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.subscriptions.clear();
  }
}

// Real-time WebSocket client instances
const realtimeClientInstances = new Map<string, RealtimeClient>();

export class RdbClient {
  private apiClient: KyInstance;
  private realtimeClient: RealtimeClient | null = null;
  private config: InternalConfig;
  private clientId: string;
  private configPromise: Promise<InternalConfig> | null = null;

  constructor(config: RdbConfig) {
    this.config = { ...config } as InternalConfig;
    this.clientId = `${config.endpoint}-${config.apiKey.substring(0, 8)}`;
    
    // Build the prefix URL with optional API prefix
    const prefixUrl = config.apiPrefix 
      ? `${config.endpoint.replace(/\/$/, '')}/${config.apiPrefix.replace(/^\//, '')}`
      : config.endpoint;
    
    // Initialize HTTP client with ky
    this.apiClient = ky.create({
      prefixUrl,
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
   * This includes GraphQL endpoint, region, and API key for real-time subscriptions
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

      // Update internal config with fetched GraphQL details
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
   * Initialize real-time WebSocket client for subscriptions
   */
  private async initializeRealtimeClient(): Promise<void> {
    if (realtimeClientInstances.has(this.clientId)) {
      this.realtimeClient = realtimeClientInstances.get(this.clientId)!;
      return;
    }

    // Ensure we have the configuration
    await this.ensureConfig();
    
    const { appSyncEndpoint, appSyncApiKey } = this.config;

    if (!appSyncEndpoint || !appSyncApiKey) {
      console.warn('[RDB] Real-time configuration incomplete. Subscriptions will not be available.');
      return;
    }

    this.realtimeClient = new RealtimeClient(appSyncEndpoint, appSyncApiKey);
    realtimeClientInstances.set(this.clientId, this.realtimeClient);
    
    // Connect to real-time service
    try {
      await this.realtimeClient.connect();
      console.log('[RDB] Real-time WebSocket client initialized successfully');
    } catch (error) {
      console.error('[RDB] Failed to connect to real-time service:', error);
    }
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
   *   description: 'User management table',
   *   indexedFields: ['email', 'username'], // Create GSIs on these fields
   *   subscriptions: [
   *     {
   *       // Specify filters - backend will create onCreate, onUpdate, onDelete subscriptions
   *       // with these filters as parameters
   *       filters: [
   *         { field: 'email', type: 'string' },
   *         { field: 'isActive', type: 'boolean' }
   *       ]
   *     }
   *   ]
   * });
   * ```
   */
  async createTableFromSchema<T extends z.ZodRawShape>(
    tableName: string,
    schema: z.ZodObject<T>,
    options: {
      description?: string;
      indexedFields?: string[]; // Array of field names to create GSIs for
      subscriptions?: Array<{ 
        // Filters that will be added as parameters to ALL subscription queries (onCreate, onUpdate, onDelete)
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
      
      // Wait for schema propagation to complete
      // This ensures resolvers and data sources are properly cleaned up
      console.log('[RDB] Waiting for schema propagation after table deletion...');
      await new Promise(resolve => setTimeout(resolve, 8000)); // 8 seconds
      console.log('[RDB] Schema propagation wait complete');
      
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
   * Internal method to get real-time WebSocket client
   */
  async getRealtimeClient(): Promise<RealtimeClient | null> {
    if (!this.config.disableRealtime) {
      await this.initializeRealtimeClient();
    }
    return this.realtimeClient;
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
      
      // Add filter parameters for indexed fields (enables efficient Query operations)
      if (options?.filters) {
        Object.entries(options.filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            searchParams.set(`filter_${key}`, String(value));
          }
        });
      }
      
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
   * Get a single record by ID using the dedicated GET endpoint
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
      // Use the dedicated GET endpoint which uses GraphQL getTYPE query
      // This performs an efficient DynamoDB GetItem operation
      const response = await this.client.getApiClient()
        .get(`tables/${this.tableName}/records/${recordId}`)
        .json<{ success: boolean, data: T | null, message?: string }>();
      
      return response;
    } catch (error: any) {
      // Handle 404 as a successful response with null data
      if (error.response?.status === 404) {
        return {
          success: true,
          data: null,
          message: 'Record not found'
        };
      }
      throw new Error(`Failed to get record: ${error.response?.data?.error || error.message}`);
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
   * Update a record in the table
   * @param recordId The ID of the record to update
   * @param updates Partial record data with fields to update
   * @returns Promise resolving to the updated record with full type safety
   * 
   * @example
   * ```typescript
   * interface User {
   *   id: string;
   *   name: string;
   *   email: string;
   *   isActive: boolean;
   * }
   * 
   * const users = client.table<User>('users');
   * const result = await users.update('user-123', { 
   *   isActive: false,
   *   email: 'newemail@example.com'
   * });
   * // result.data is typed as User with all fields
   * ```
   */
  async update(recordId: string, updates: Partial<Omit<T, 'id' | 'createdAt'>>): Promise<ApiResponse<T>> {
    try {
      // Remove system-managed fields that should never be updated
      const cleanUpdates = { ...updates } as any;
      delete cleanUpdates.id;
      delete cleanUpdates.createdAt;
      delete cleanUpdates.updatedAt; // Backend will set this automatically

      // If this table has a schema attached, validate the updates
      if ((this as any)._schema) {
        try {
          // Validate only the fields being updated (partial validation)
          (this as any)._schema.partial().parse(cleanUpdates);
        } catch (validationError: any) {
          throw new Error(`Validation failed: ${validationError.message}`);
        }
      }

      // Backend returns { success: true, message: string, data: record }
      const response = await this.client.getApiClient()
        .put(`tables/${this.tableName}/records/${recordId}`, { json: cleanUpdates })
        .json<{ success: boolean, message: string, data: T }>();
      return response;
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
      throw new Error(`Failed to update record: ${errorMessage}`);
    }
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
   * You must explicitly specify which event to listen to (create/update/delete)
   * 
   * @param options Subscription options with typed event handlers
   * @returns Promise resolving to a typed subscription instance
   * 
   * @example
   * ```typescript
   * interface User {
   *   id: string;
   *   name: string;
   *   email: string;
   *   active: boolean;
   * }
   * 
   * const users = client.table<User>('users');
   * 
   * // Subscribe to create events
   * const createSub = await users.subscribe({
   *   event: 'create',
   *   filters: { active: true },
   *   onData: (user: User) => console.log('New user:', user.name)
   * });
   * 
   * // Subscribe to update events
   * const updateSub = await users.subscribe({
   *   event: 'update',
   *   onData: (user: User) => console.log('Updated user:', user.name)
   * });
   * 
   * // Subscribe to delete events
   * const deleteSub = await users.subscribe({
   *   event: 'delete',
   *   onData: (user: User) => console.log('Deleted user:', user.id)
   * });
   * ```
   */
  async subscribe(options: SubscriptionOptions<T>): Promise<RdbSubscription<T>> {
    const realtimeClient = await this.client.getRealtimeClient();
    
    if (!realtimeClient) {
      throw new Error('Real-time service is not configured or real-time features are disabled. Cannot create subscriptions.');
    }

    return new RdbSubscription<T>(realtimeClient, this.tableName, options, this.client);
  }
}

export class RdbSubscription<T = any> {
  private realtimeClient: RealtimeClient;
  private tableName: string;
  private options: SubscriptionOptions<T>;
  private subscriptionId: string | null = null;
  private client: RdbClient;

  constructor(realtimeClient: RealtimeClient, tableName: string, options: SubscriptionOptions<T>, client: RdbClient) {
    this.realtimeClient = realtimeClient;
    this.tableName = tableName;
    this.options = options;
    this.client = client;
    this.subscriptionId = `rdb-${tableName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start the subscription with full type safety
   * @returns Promise resolving to the subscription ID
   * 
   * @example
   * ```typescript
   * const subscription = await users.subscribe({
   *   event: 'create', // Specify which event to listen to
   *   filters: { active: true }, // Optional runtime filters
   *   onData: (user: User) => console.log('New user:', user)
   * });
   * await subscription.connect();
   * ```
   */
  async connect(): Promise<string> {
    if (!this.subscriptionId) {
      throw new Error('Subscription ID not set');
    }

    // Get table metadata to fetch the GraphQL type name and subscription config
    let graphqlTypeName: string;
    let fields: string[] = [];
    let subscriptionConfig: any = null;
    
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
        if (table.subscriptions && table.subscriptions.length > 0) {
          subscriptionConfig = table.subscriptions[0]; // Use first subscription config
        }
      } else {
        throw new Error(`Table ${this.tableName} not found`);
      }
    } else {
      throw new Error('Failed to fetch table metadata');
    }
    
    // Build GraphQL subscription query with dynamic fields and filter arguments
    const fieldsQuery = fields.join('\n        ');
    
    // Build filter arguments from the subscription configuration
    const filterArgs: string[] = [];
    const filterVariables: { [key: string]: any } = {};
    
    if (subscriptionConfig && subscriptionConfig.filters) {
      // Use filters from subscription configuration
      subscriptionConfig.filters.forEach((filter: any) => {
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
    const subscriptionFieldArgs = filterArgs.length > 0
      ? `(${filterArgs
          .map(arg => {
            const parts = arg.split(':');
            const varName = parts[0]?.trim().substring(1); // Extract variable name without $
            return `${varName}: $${varName}`;
          })
          .join(', ')})`
      : '';
    
    // Build the subscription query for the specified event
    const variableDefinitions = filterArgs.length > 0 ? `(${filterArgs.join(', ')})` : '';
    const eventName = this.capitalize(this.options.event); // 'Create', 'Update', or 'Delete'
    
    console.log(`[RDB] Subscribing to '${this.options.event}' event for table '${this.tableName}'`);
    
    // Build the GraphQL subscription query as a string (no gql template literal)
    const subscriptionQuery = `
      subscription On${graphqlTypeName}${eventName}${variableDefinitions} {
        on${graphqlTypeName}${eventName}${subscriptionFieldArgs} {
          ${fieldsQuery}
        }
      }
    `.trim();

    console.log('[RDB] Generated subscription query:', subscriptionQuery);
    console.log('[RDB] Subscription variables:', filterVariables);

    // Create subscription handler
    const handler: SubscriptionHandler<T> = {
      id: this.subscriptionId,
      query: subscriptionQuery,
      variables: filterVariables,
      onData: (data: any) => {
        console.log(`[RDB] Subscription data received for ${this.tableName}:`, data);
        if (this.options.onData) {
          // Look for the specific event field
          const eventName = this.capitalize(this.options.event);
          const typedData = data[`on${graphqlTypeName}${eventName}`];
          
          if (typedData) {
            this.options.onData(typedData as T);
          }
        }
      },
      onError: (error: any) => {
        console.error(`[RDB] Subscription error for ${this.tableName}:`, error);
        if (this.options.onError) {
          this.options.onError(error);
        }
      },
      onComplete: () => {
        console.log(`[RDB] Subscription completed for ${this.tableName}`);
        if (this.options.onComplete) {
          this.options.onComplete();
        }
      },
    };

    // Start the subscription
    this.realtimeClient.startSubscription(handler);

    return this.subscriptionId;
  }

  /**
   * Disconnect the subscription
   */
  disconnect(): void {
    if (this.subscriptionId) {
      this.realtimeClient.stopSubscription(this.subscriptionId);
      console.log(`Subscription disconnected for ${this.tableName}`);
      this.subscriptionId = null;
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