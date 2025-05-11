module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/', '<rootDir>/test/'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  // Phase 1 coverage thresholds (current phase)
  // Phase 1: 45% statements/lines, 35% branches, 45% functions
  // Phase 2: 65% statements/lines, 50% branches, 65% functions
  // Phase 3: 80% statements/lines, 60% branches, 80% functions
  coverageThreshold: {
    global: {
      branches: 35,
      functions: 45,
      lines: 45,
      statements: 45,
    },
  },
  moduleNameMapper: {
    '^homey$': '<rootDir>/test/mocks/homey.mock.ts',
  },
};
