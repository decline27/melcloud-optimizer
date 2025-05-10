# Comprehensive Testing Strategy

## Overview

This document outlines a comprehensive testing strategy for the MELCloud Optimizer codebase. The goal is to ensure high code quality, reliability, and maintainability through effective testing practices.

## Current Test Coverage Status

Based on the analysis of the current codebase, the test coverage is as follows:

```
------------------------|---------|----------|---------|---------|-------------------
File                    | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
------------------------|---------|----------|---------|---------|-------------------
All files               |   58.65 |    44.55 |   67.69 |   58.72 |                   
 src                    |   22.04 |     9.33 |      25 |   22.35 |                   
  api.ts                |     100 |      100 |     100 |     100 |                   
  app.simple.ts         |       0 |        0 |       0 |       0 | 1-275             
  app.ts                |   26.62 |    10.14 |   28.57 |   26.79 | ...20-570,606-772 
 src/services           |   87.79 |    69.34 |   84.09 |   88.72 |                   
  cop-helper.ts         |   74.77 |     54.9 |   63.15 |   77.57 | ...32,153,297-299 
  melcloud-api.ts       |     100 |      100 |     100 |     100 |                   
  optimizer.ts          |   91.41 |    70.96 |     100 |    91.3 | ...00-401,473-479 
  tibber-api.ts         |     100 |    93.33 |     100 |     100 | 102               
 ...vices/thermal-model |   72.72 |       53 |   76.74 |   72.13 |                   
  data-collector.ts     |   88.88 |      100 |      70 |   88.88 | 150-162           
  index.ts              |     100 |      100 |     100 |     100 |                   
  thermal-analyzer.ts   |   86.82 |    81.39 |   91.66 |    87.6 | ...26,303,332-346 
  ...l-model-service.ts |   51.87 |       25 |   71.42 |    49.6 | ...25-426,448,480 
 src/util               |   97.56 |    84.61 |    90.9 |   97.56 |                   
  logger.ts             |   97.56 |    84.61 |    90.9 |   97.56 | 123               
------------------------|---------|----------|---------|---------|-------------------
```

Key observations:
1. Some critical components have good coverage (melcloud-api.ts, tibber-api.ts)
2. Other critical components have insufficient coverage (app.ts, thermal-model-service.ts)
3. Branch coverage is particularly low across the codebase
4. Some files have no coverage at all (app.simple.ts)

## Testing Goals

The following coverage targets are established:

1. **Phase 1 (Initial Improvement)**:
   - 50% statements/lines
   - 40% branches
   - 50% functions

2. **Phase 2 (Intermediate)**:
   - 65% statements/lines
   - 50% branches
   - 65% functions

3. **Phase 3 (Target)**:
   - 80% statements/lines
   - 60% branches
   - 80% functions

## Testing Approach

### 1. Unit Testing

Unit tests focus on testing individual components in isolation, with dependencies mocked.

#### Key Components to Test:

1. **API Services**:
   - `melcloud-api.ts`: Test all API methods with mocked fetch responses
   - `tibber-api.ts`: Test price data retrieval and formatting

2. **Optimizer**:
   - `optimizer.ts`: Test temperature calculation algorithms
   - Test COP integration and adjustments

3. **Thermal Model**:
   - `thermal-analyzer.ts`: Test prediction algorithms
   - `data-collector.ts`: Test data collection and storage
   - `thermal-model-service.ts`: Test recommendation generation

4. **App Core**:
   - `app.ts`: Test cron job initialization
   - Test settings handling
   - Test timeline entry creation

#### Testing Techniques:

1. **Mocking**:
   - Use Jest's mocking capabilities to isolate components
   - Create standardized mocks for common dependencies
   - Mock API responses for predictable testing

2. **Edge Case Testing**:
   - Test with boundary values (min/max temperatures)
   - Test with invalid inputs
   - Test error handling paths

3. **Code Coverage**:
   - Use Jest's coverage reporting to identify untested code
   - Focus on branch coverage for conditional logic

### 2. Integration Testing

Integration tests verify that components work together correctly.

#### Key Workflows to Test:

1. **Hourly Optimization**:
   - Test the complete optimization workflow
   - Verify API calls and data flow
   - Test with various price scenarios

2. **Weekly Calibration**:
   - Test thermal model calibration
   - Verify data collection and analysis

3. **Timeline Entry Creation**:
   - Test different API fallback mechanisms
   - Verify error handling

#### Testing Techniques:

1. **Partial Mocking**:
   - Mock external APIs but use real component implementations
   - Test interactions between real components

2. **Scenario Testing**:
   - Test common usage scenarios
   - Test error recovery scenarios

### 3. End-to-End Testing

End-to-end tests verify the system works correctly in a real environment.

#### Key Scenarios to Test:

1. **Complete App Lifecycle**:
   - Test initialization, operation, and shutdown
   - Verify cron job scheduling and execution

2. **API Integration**:
   - Test with real API endpoints (using test accounts)
   - Verify data retrieval and processing

#### Testing Techniques:

1. **Manual Testing**:
   - Test on actual Homey device
   - Verify timeline entries and notifications

2. **Automated E2E Tests**:
   - Create automated tests for critical paths
   - Use test accounts for API integration

## Test Implementation Plan

### Phase 1: Fix Existing Tests and Improve Coverage for Critical Components

1. **Fix Failing Tests**:
   - Fix tests in `optimizer.real.test.ts` and `optimizer.enhanced.test.ts`
   - Update mocks to match current API implementations

2. **Improve Coverage for Critical Components**:
   - Focus on `optimizer.ts`, `melcloud-api.ts`, and `tibber-api.ts`
   - Add tests for error handling paths

3. **Implement Standardized Mocking**:
   - Create `test/mocks/index.ts` with standardized mocks
   - Update existing tests to use standardized mocks

### Phase 2: Add Integration Tests and Improve App Coverage

1. **Add Integration Tests**:
   - Create `test/integration/optimization-workflow.test.ts`
   - Test complete optimization workflow

2. **Improve App Coverage**:
   - Add tests for `app.ts` focusing on cron job management
   - Test settings handling and validation

3. **Enhance Thermal Model Tests**:
   - Improve coverage for `thermal-model-service.ts`
   - Test recommendation generation with various scenarios

### Phase 3: Comprehensive Coverage and Edge Cases

1. **Add Edge Case Tests**:
   - Test with extreme values and invalid inputs
   - Test error recovery mechanisms

2. **Improve Branch Coverage**:
   - Focus on conditional logic in all components
   - Test all branches of if/else statements

3. **Add End-to-End Tests**:
   - Create automated E2E tests for critical paths
   - Test with real API endpoints (using test accounts)

## Testing Tools and Infrastructure

1. **Jest**:
   - Primary testing framework
   - Used for unit and integration tests
   - Provides coverage reporting

2. **TypeScript**:
   - Ensures type safety in tests
   - Helps catch type-related issues

3. **Mocking**:
   - Jest's mocking capabilities
   - Custom mock implementations for external dependencies

4. **Coverage Reporting**:
   - Jest's built-in coverage reporting
   - HTML reports for detailed analysis

## Best Practices

1. **Test Organization**:
   - Keep tests close to the code they test
   - Use descriptive test names
   - Group related tests with `describe` blocks

2. **Test Independence**:
   - Each test should be independent of others
   - Reset state between tests
   - Avoid test order dependencies

3. **Mocking Strategy**:
   - Mock external dependencies consistently
   - Use standardized mocks for common dependencies
   - Avoid excessive mocking of internal components

4. **Coverage Goals**:
   - Focus on meaningful coverage, not just numbers
   - Prioritize critical paths and error handling
   - Use coverage reports to identify gaps

## Continuous Integration

1. **Automated Testing**:
   - Run tests automatically on code changes
   - Enforce coverage thresholds

2. **Coverage Reporting**:
   - Generate coverage reports for each build
   - Track coverage trends over time

3. **Test Performance**:
   - Monitor test execution time
   - Optimize slow tests

## Conclusion

This comprehensive testing strategy provides a roadmap for improving the test coverage and quality of the MELCloud Optimizer codebase. By following this plan, we can ensure the application is reliable, maintainable, and robust against errors.
