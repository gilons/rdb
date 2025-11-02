/**
 * DynamoDB utilities index
 * Exports all DynamoDB operations for tables and records
 */

// Table metadata operations
export {
  queryTablesByApiKey,
  getTable,
  putTable,
  updateTable,
  deleteTableMetadata,
  createUserDataTable,
  deleteUserDataTable,
  dynamodb as tablesDynamodb,
  dynamodbService
} from './tables-utils';

// Record data operations
export {
  getRecord,
  putRecord,
  updateRecord,
  deleteRecord,
  queryRecords,
  scanRecords,
  batchGetRecords,
  batchWriteRecords,
  dynamodb as recordsDynamodb
} from './records-utils';
