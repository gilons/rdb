/**
 * RDB CDK Construct Library
 * 
 * AWS CDK construct for deploying RDB (Realtime Database) infrastructure.
 * 
 * @packageDocumentation
 */

export { RdbConstruct, RdbConstructProps, InitialTableConfig } from './rdb-construct';

// Re-export types for convenience
export type { 
  TableField, 
  TableConfig, 
  TableSubscription,
  TableItem,
  RdbConfig,
  SubscriptionOptions,
  QueryOptions
} from '../types';
