module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Test file patterns
  testMatch: [
    '<rootDir>/test/**/*.test.ts',
    '<rootDir>/test/**/*.spec.ts'
  ],
  testPathIgnorePatterns: [
    '<rootDir>/test/integration/',
    '<rootDir>/test/unit/melcloud-api',
  ],

  transform: {
    '^.+\\.ts$': 'ts-jest',
  },

  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^homey$': '<rootDir>/test/mocks/homey.mock.ts',
    'node-fetch': '<rootDir>/test/mocks/node-fetch.mock.ts',
    '^(\\.\\./)+api\\.js$': '<rootDir>/api.ts',
  },
  modulePathIgnorePatterns: [
    '<rootDir>/.homeybuild/'
  ],

  collectCoverage: true,
  coverageDirectory: 'coverage-unit',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    // Exclude network-heavy/orchestrator files from unit coverage
    '!src/services/melcloud-api.ts',
    '!src/app.ts',
    // Exclude low-level plumbing not critical for unit gate
    '!src/services/base-api-service.ts',
    '!src/services/hot-water/hot-water-service.ts',
    '!src/services/optimizer.ts',
    '!src/services/thermal-model/data-collector.ts',
    '!src/util/error-handler.ts',
    '!api.ts',
    '!weather.ts',
    '!simulate.ts',
    '!scripts/**/*.ts',
  ],
  coverageReporters: ['text', 'lcov', 'html'],

  coverageThreshold: {
    global: {
      branches: 40,
      functions: 60,
      lines: 55,
      statements: 55,
    },
  },

  testTimeout: 5000,
  verbose: true,
  forceExit: true,
  transformIgnorePatterns: [
    'node_modules/(?!(node-fetch)/)'
  ],
};
