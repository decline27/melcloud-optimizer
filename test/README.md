# Testing Guide

This project uses a comprehensive testing strategy with both unit tests and integration tests.

## Test Structure

```
test/
├── unit/              # Unit tests with mocks
├── integration/       # Integration tests with real APIs
├── mocks/            # Mock implementations
├── config.json       # Local credentials (gitignored)
├── config.example.json # Template for credentials
└── test-config.ts    # Configuration loader
```

## Unit Tests

Unit tests use mocks and don't require real API credentials. They test individual components in isolation:

```bash
npm test test/unit/
```

## Integration Tests

Integration tests connect to real APIs and require valid credentials.

### Setup for Integration Tests

1. **Copy the example config:**
   ```bash
   cp test/config.example.json test/config.json
   ```

2. **Add your real credentials to `test/config.json`:**
   ```json
   {
     "melcloud": {
       "email": "your-actual-email@example.com",
       "password": "your-actual-password"
     },
     "tibber": {
       "token": "your-actual-tibber-token"
     },
     "test": {
       "skipIntegration": false,
       "timeout": 30000
     }
   }
   ```

3. **Run integration tests:**
   ```bash
   npm test test/integration/
   ```

### Important Notes

- ⚠️ **Never commit `test/config.json`** - it's in `.gitignore` for security
- 🔒 **Integration tests use real API calls** - they may affect your actual devices
- ⏱️ **Integration tests are slower** - they have longer timeouts
- 🚫 **Integration tests are automatically skipped** if no real credentials are configured

## Test Configuration

The `test/test-config.ts` module handles configuration loading:

- If `test/config.json` exists → loads real credentials
- If missing → shows warning and skips integration tests
- Provides type-safe configuration interface

## Running Tests

```bash
# Run all tests
npm test

# Run only unit tests (fast, no API calls)
npm test test/unit/

# Run only integration tests (slow, real API calls)
npm test test/integration/

# Run specific test file
npm test test/unit/melcloud-api.simple.test.ts

# Run with coverage
npm run test:coverage
```

## CI/CD Considerations

- Unit tests run in CI/CD pipelines
- Integration tests should be run manually or in dedicated environments
- Use environment variables in CI for sensitive data
- Consider using test API accounts for integration testing

## Best Practices

1. **Write unit tests first** - they're fast and reliable
2. **Use integration tests sparingly** - for critical workflows only
3. **Mock external dependencies** in unit tests
4. **Keep credentials secure** - never commit them
5. **Test edge cases** in unit tests with controlled mocks
