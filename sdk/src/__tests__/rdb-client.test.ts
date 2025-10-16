// Mock ky to avoid making real HTTP requests in tests
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();

// Create the mock instance that will be returned by ky.create()
const mockKyInstance = {
  get: mockGet,
  post: mockPost,
  put: mockPut,
  delete: mockDelete,
  patch: jest.fn(),
  head: jest.fn(),
  create: jest.fn(),
  extend: jest.fn(),
  stop: jest.fn(),
} as any;

// Mock the ky module
jest.mock('ky', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => mockKyInstance),
  },
}));

// Import ky to get the mocked version
import ky from 'ky';

// Mock Apollo Client
jest.mock('@apollo/client', () => ({
  ApolloClient: jest.fn(),
  InMemoryCache: jest.fn(),
  HttpLink: jest.fn(),
  from: jest.fn(),
  gql: jest.fn(),
  Observable: jest.fn(),
}));

// Mock AWS AppSync links
jest.mock('aws-appsync-auth-link', () => ({
  createAuthLink: jest.fn(),
}));

jest.mock('aws-appsync-subscription-link', () => ({
  createSubscriptionHandshakeLink: jest.fn(),
}));

import { RdbClient } from '../index';

describe('RdbClient', () => {
  const mockConfig = {
    endpoint: 'https://api.example.com',
    apiKey: 'test-api-key',
    appSyncEndpoint: 'https://appsync.example.com/graphql',
    appSyncRegion: 'us-east-1',
    appSyncApiKey: 'test-appsync-key',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the ky mock to return proper chainable methods
    const ky = require('ky').default;
    ky.create.mockReturnValue({
      get: jest.fn().mockReturnValue({
        json: jest.fn().mockResolvedValue({ tables: ['users', 'products'] })
      }),
      post: jest.fn().mockReturnValue({
        json: jest.fn().mockResolvedValue({ success: true })
      }),
      put: jest.fn().mockReturnValue({
        json: jest.fn().mockResolvedValue({ success: true })
      }),
      delete: jest.fn().mockReturnValue({
        json: jest.fn().mockResolvedValue({ success: true })
      }),
    });
  });

  describe('constructor', () => {
    it('should create an RdbClient instance with valid config', () => {
      const client = new RdbClient(mockConfig);
      expect(client).toBeInstanceOf(RdbClient);
    });

    it('should create an RdbClient without AppSync config', () => {
      const minimalConfig = {
        endpoint: mockConfig.endpoint,
        apiKey: mockConfig.apiKey,
      };
      
      const client = new RdbClient(minimalConfig);
      expect(client).toBeInstanceOf(RdbClient);
    });
  });

  describe('table method', () => {
    it('should return an RdbTable instance', () => {
      const client = new RdbClient(mockConfig);
      const table = client.table('users');
      
      expect(table).toBeDefined();
      expect(table.constructor.name).toBe('RdbTable');
    });

    it('should return consistent table instances for the same table name', () => {
      const client = new RdbClient(mockConfig);
      const table1 = client.table('users');
      const table2 = client.table('users');
      
      // Both tables should have the same table name and client reference
      expect(table1.constructor.name).toBe('RdbTable');
      expect(table2.constructor.name).toBe('RdbTable');
    });
  });

  describe('table management methods', () => {
    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();
      
      // Verify ky.create is mocked properly
      const mockCreate = ky.create as jest.MockedFunction<typeof ky.create>;
      mockCreate.mockReturnValue(mockKyInstance);
      
      // Mock the SDK config endpoint response for initialization
      mockGet.mockImplementation((url: string) => {
        if (url === 'sdk/config') {
          return {
            json: jest.fn().mockResolvedValue({
              appSync: {
                endpoint: 'https://test-appsync.amazonaws.com/graphql',
                region: 'us-east-1',
                apiKey: 'test-appsync-api-key'
              },
              ttl: 3600
            })
          };
        }
        // Default mock for other GET requests
        return {
          json: jest.fn().mockResolvedValue({ success: true })
        };
      });
    });

    it('should call createTable endpoint', async () => {
      // Mock backend response format
      const backendResponse = { 
        message: 'Table created successfully', 
        table: { tableName: 'users', tableId: 'table-123' } 
      };
      
      // Expected SDK response format after transformation
      const expectedResponse = {
        success: true,
        message: 'Table created successfully',
        data: { tableName: 'users', tableId: 'table-123' }
      };
      
      mockPost.mockReturnValue({
        json: jest.fn().mockResolvedValue(backendResponse)
      });

      const client = new RdbClient(mockConfig);
      
      const tableConfig = {
        tableName: 'users',
        fields: [
          { name: 'name', type: 'String' as const, required: true },
          { name: 'email', type: 'String' as const, required: true },
        ],
      };

      const result = await client.createTable(tableConfig);
      
      expect(mockPost).toHaveBeenCalledWith('tables', {
        json: tableConfig,
      });
      expect(result).toEqual(expectedResponse);
    });

    it('should call deleteTable endpoint', async () => {
      // Mock backend response format
      const backendResponse = { message: 'Table deleted successfully' };
      
      // Expected SDK response format after transformation
      const expectedResponse = { 
        success: true, 
        message: 'Table deleted successfully' 
      };
      
      mockDelete.mockReturnValue({
        json: jest.fn().mockResolvedValue(backendResponse)
      });

      const client = new RdbClient(mockConfig);
      const result = await client.deleteTable('users');
      
      expect(mockDelete).toHaveBeenCalledWith('tables/users');
      expect(result).toEqual(expectedResponse);
    });

    it('should call listTables endpoint', async () => {
      // Mock backend response format
      const backendResponse = { 
        tables: [
          { tableName: 'users' },
          { tableName: 'products' }
        ],
        count: 2
      };
      
      // Expected SDK response format after transformation
      const expectedResponse = { 
        success: true,
        data: {
          items: [
            { tableName: 'users' },
            { tableName: 'products' }
          ],
          count: 2
        }
      };
      
      // Set specific response for listTables
      mockGet.mockImplementation((url: string) => {
        if (url === 'sdk/config') {
          return {
            json: jest.fn().mockResolvedValue({
              appSync: {
                endpoint: 'https://test-appsync.amazonaws.com/graphql',
                region: 'us-east-1',
                apiKey: 'test-appsync-api-key'
              }
            })
          };
        } else if (url === 'tables') {
          return {
            json: jest.fn().mockResolvedValue(backendResponse)
          };
        }
        return {
          json: jest.fn().mockResolvedValue({ success: true })
        };
      });

      const client = new RdbClient(mockConfig);
      const result = await client.listTables();
      
      expect(mockGet).toHaveBeenCalledWith('tables');
      expect(result).toEqual(expectedResponse);
    });

    it('should call getTableSchema endpoint', async () => {
      const mockSchema = {
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
      };
      
      // Set specific response for getTableSchema
      mockGet.mockImplementation((url: string) => {
        if (url === 'sdk/config') {
          return {
            json: jest.fn().mockResolvedValue({
              appSync: {
                endpoint: 'https://test-appsync.amazonaws.com/graphql',
                region: 'us-east-1',
                apiKey: 'test-appsync-api-key'
              }
            })
          };
        } else if (url === 'tables/users/schema') {
          return {
            json: jest.fn().mockResolvedValue(mockSchema)
          };
        }
        return {
          json: jest.fn().mockResolvedValue({ success: true })
        };
      });

      const client = new RdbClient(mockConfig);
      const result = await client.getTableSchema('users');
      
      expect(mockGet).toHaveBeenCalledWith('tables/users/schema');
      expect(result).toEqual(mockSchema);
    });

    it('should handle createTable errors properly', async () => {
      const errorResponse = new Error('Network error');
      
      mockPost.mockReturnValue({
        json: jest.fn().mockRejectedValue(errorResponse)
      });

      const client = new RdbClient(mockConfig);
      
      const tableConfig = {
        tableName: 'users',
        fields: [
          { name: 'name', type: 'String' as const, required: true },
        ],
      };

      await expect(client.createTable(tableConfig)).rejects.toThrow('Failed to create table: Network error');
      expect(mockPost).toHaveBeenCalledWith('tables', {
        json: tableConfig,
      });
    });

    it('should handle deleteTable errors properly', async () => {
      const errorResponse = new Error('Table not found');
      
      mockDelete.mockReturnValue({
        json: jest.fn().mockRejectedValue(errorResponse)
      });

      const client = new RdbClient(mockConfig);

      await expect(client.deleteTable('nonexistent')).rejects.toThrow('Failed to delete table: Table not found');
      expect(mockDelete).toHaveBeenCalledWith('tables/nonexistent');
    });
  });
});