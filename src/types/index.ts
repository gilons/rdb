export interface TableField {
  name: string;
  type: 'String' | 'Int' | 'Float' | 'Boolean' | 'Array';
  required?: boolean;
  indexed?: boolean;
  primary?: boolean;
}

export interface TableSubscription {
  event: 'create' | 'update' | 'delete' | 'change';
  filters?: Array<{
    field: string;
    type: string;
    operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';
    value?: any;
  }>;
}

export interface TableConfig {
  tableName: string;
  fields: TableField[];
  subscriptions?: TableSubscription[];
  description?: string;
  graphqlTypeName?: string;
}

export interface TableItem extends TableConfig {
  apiKey: string;
  tableId: string;
  graphqlTypeName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyItem {
  apiKeyId: string;
  name: string;
  description: string;
  keyHash: string;
  createdAt: string;
  lastUsed?: string;
  isActive: boolean;
}

export interface Record {
  [key: string]: any;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  count: number;
  nextToken?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// SDK Types
export interface RdbConfig {
  apiKey: string;
  endpoint: string;
  region?: string;
  appSyncEndpoint?: string;
  appSyncRegion?: string;
  appSyncApiKey?: string;
}

export interface SubscriptionOptions {
  filters?: { [key: string]: any };
  onData?: (data: any) => void;
  onError?: (error: any) => void;
  onComplete?: () => void;
}

export interface QueryOptions {
  limit?: number;
  nextToken?: string;
  filters?: { [key: string]: any };
}