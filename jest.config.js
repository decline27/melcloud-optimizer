const isCI = !!process.env.CI;
const testPathIgnorePatterns = [
  // Always ignore build artifacts
  '<rootDir>/.homeybuild/',
];

if (isCI) {
  // In CI/full runs, skip network/integration and brittle https low-level tests
  testPathIgnorePatterns.push(
    '<rootDir>/test/integration/',
    '<rootDir>/test/unit/melcloud-api\.credentials\.test\.ts',
    '<rootDir>/test/unit/melcloud-api\.https\.error\.test\.ts',
    '<rootDir>/test/unit/melcloud-api\.https\.deterministic-errors\.test\.ts'
  );
}

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
  
  // Dynamically ignore brittle or network tests in CI/full runs
  testPathIgnorePatterns,
  
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
  
  // Coverage thresholds - increased for better quality
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 70,
      statements: 70,
    },
  },
  
  // Test execution settings
  testTimeout: 5000,
  verbose: true,
  forceExit: true,
  
  // Handle ES modules
  transformIgnorePatterns: [
    'node_modules/(?!(node-fetch)/)'
  ],
};
