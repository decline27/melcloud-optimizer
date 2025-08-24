module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '<rootDir>/test/**/*.test.ts',
    '<rootDir>/test/**/*.spec.ts'
  ],
  
  // TypeScript transformation
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  
  // Module settings
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^homey$': '<rootDir>/test/mocks/homey.mock.ts',
    'node-fetch': '<rootDir>/test/mocks/node-fetch.mock.ts',
  },
  
  // Coverage settings
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 35,
      functions: 45,
      lines: 45,
      statements: 45,
    },
  },
  
  // Test execution settings
  testTimeout: 5000,
  verbose: true,
  forceExit: true,
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.ts'],
  
  // Handle ES modules
  transformIgnorePatterns: [
    'node_modules/(?!(node-fetch)/)'
  ],
};
