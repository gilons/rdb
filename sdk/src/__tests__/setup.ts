// Test setup file - this file is for setup only, not a test file
import 'jest';

global.console = {
  ...console,
  // Suppress console.warn in tests unless needed
  warn: jest.fn(),
};

// Mock fetch for testing
global.fetch = jest.fn();

// This setup file doesn't contain tests, just configuration