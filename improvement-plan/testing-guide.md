# Testing Guide for Memory Optimization

This document provides guidance on how to test the memory optimization, type safety, and API logging improvements after implementation.

## Memory Usage Testing

### Long-Running Test

1. **Setup Test Environment**
   - Create a test script that simulates normal app operation
   - Run the app for at least 24 hours
   - Configure to collect thermal data points every 5 minutes

2. **Memory Profiling**
   - Use Node.js built-in memory profiling:
     ```bash
     # Run with memory profiling enabled
     node --inspect app.js
     ```
   - Connect Chrome DevTools to the Node.js process
   - Take heap snapshots at regular intervals (start, 1h, 6h, 12h, 24h)

3. **Metrics to Monitor**
   - Heap usage over time
   - Number of data points stored
   - Frequency of garbage collection
   - Memory usage after cleanup operations

4. **Success Criteria**
   - Memory usage should stabilize after initial growth
   - No continuous memory growth over 24+ hours
   - Cleanup operations should reduce memory usage
   - No memory leaks identified in heap snapshots

### Stress Test

1. **Setup**
   - Create a script that rapidly adds data points (1 per second)
   - Run for 1 hour (3600 data points)

2. **Monitoring**
   - Track memory usage throughout the test
   - Monitor when cleanup operations trigger
   - Check data aggregation functionality

3. **Success Criteria**
   - App should not crash due to memory issues
   - Memory usage should remain below critical thresholds
   - Data aggregation should occur as expected

## Type Safety Testing

### Unit Tests

1. **Type Guard Tests**
   ```typescript
   // test/unit/validation.test.ts
   
   import { isWeatherData, isThermalDataPoint } from '../../src/util/validation';
   
   describe('Type Guards', () => {
     describe('isWeatherData', () => {
       it('should return true for valid weather data', () => {
         const validData = {
           timestamp: new Date(),
           temperature: 20,
           windSpeed: 5,
           humidity: 60,
           cloudCover: 30,
           precipitation: 0
         };
         expect(isWeatherData(validData)).toBe(true);
       });
       
       it('should return false for invalid weather data', () => {
         const invalidData = {
           timestamp: new Date(),
           temperature: 20,
           // Missing required fields
         };
         expect(isWeatherData(invalidData)).toBe(false);
       });
       
       it('should return false for null or undefined', () => {
         expect(isWeatherData(null)).toBe(false);
         expect(isWeatherData(undefined)).toBe(false);
       });
     });
     
     // Similar tests for isThermalDataPoint
   });
   ```

2. **Interface Compliance Tests**
   - Create tests that verify objects conform to defined interfaces
   - Test boundary conditions (min/max values, empty arrays, etc.)

3. **API Parameter Validation**
   - Test all public methods with valid and invalid parameters
   - Verify appropriate error handling for invalid inputs

## API Logging Testing

1. **Log Capture Setup**
   ```typescript
   // test/unit/api-logging.test.ts
   
   import { BaseApiService } from '../../src/services/base-api-service';
   
   describe('API Logging', () => {
     let loggerMock;
     let apiService;
     
     beforeEach(() => {
       loggerMock = {
         debug: jest.fn(),
         info: jest.fn(),
         warn: jest.fn(),
         error: jest.fn()
       };
       
       apiService = new TestApiService(loggerMock);
     });
     
     it('should log successful API calls', async () => {
       const mockResult = { data: 'test' };
       const mockApiCall = jest.fn().mockResolvedValue(mockResult);
       
       const result = await apiService.testLogApiCall('test/endpoint', { param: 'value' }, mockApiCall);
       
       expect(result).toEqual(mockResult);
       expect(loggerMock.debug).toHaveBeenCalledTimes(2);
       expect(loggerMock.debug).toHaveBeenCalledWith(
         expect.stringContaining('API call to test/endpoint started'),
         expect.objectContaining({ params: { param: 'value' } })
       );
       expect(loggerMock.debug).toHaveBeenCalledWith(
         expect.stringContaining('API call to test/endpoint completed')
       );
     });
     
     it('should log failed API calls', async () => {
       const mockError = new Error('API failure');
       const mockApiCall = jest.fn().mockRejectedValue(mockError);
       
       await expect(apiService.testLogApiCall('test/endpoint', { param: 'value' }, mockApiCall))
         .rejects.toThrow('API failure');
       
       expect(loggerMock.debug).toHaveBeenCalledTimes(1);
       expect(loggerMock.error).toHaveBeenCalledTimes(1);
       expect(loggerMock.error).toHaveBeenCalledWith(
         expect.stringContaining('API call to test/endpoint failed'),
         expect.objectContaining({
           params: { param: 'value' },
           error: 'API failure'
         })
       );
     });
     
     it('should redact sensitive parameters', async () => {
       const mockApiCall = jest.fn().mockResolvedValue({});
       
       await apiService.testLogApiCall('test/endpoint', {
         username: 'testuser',
         password: 'secret123',
         apiKey: 'abc123',
         nested: { secretToken: 'xyz789' }
       }, mockApiCall);
       
       expect(loggerMock.debug).toHaveBeenCalledWith(
         expect.any(String),
         expect.objectContaining({
           params: {
             username: 'testuser',
             password: '[REDACTED]',
             apiKey: '[REDACTED]',
             nested: { secretToken: '[REDACTED]' }
           }
         })
       );
     });
   });
   
   // Test implementation of BaseApiService for testing
   class TestApiService extends BaseApiService {
     constructor(logger) {
       super(logger);
     }
     
     async testLogApiCall(endpoint, params, apiCallFn) {
       return this.logApiCall(endpoint, params, apiCallFn);
     }
   }
   ```

## Shutdown Testing

1. **Graceful Shutdown Test**
   ```typescript
   // test/unit/app-shutdown.test.ts
   
   import { App } from '../../src/app';
   
   describe('App Shutdown', () => {
     let app;
     let thermalModelServiceMock;
     let optimizationCronJobMock;
     
     beforeEach(() => {
       // Setup mocks
       thermalModelServiceMock = {
         stop: jest.fn()
       };
       
       optimizationCronJobMock = {
         stop: jest.fn()
       };
       
       // Create app instance with mocks
       app = new App();
       app.thermalModelService = thermalModelServiceMock;
       app.optimizationCronJob = optimizationCronJobMock;
       app.memoryMonitorInterval = setInterval(() => {}, 1000);
       
       // Mock other methods
       app.log = jest.fn();
       app.error = jest.fn();
       app.saveAllSettings = jest.fn().mockResolvedValue(undefined);
     });
     
     afterEach(() => {
       // Clean up any intervals
       clearInterval(app.memoryMonitorInterval);
     });
     
     it('should properly clean up all resources on shutdown', async () => {
       await app.onUninit();
       
       // Verify all cleanup methods were called
       expect(thermalModelServiceMock.stop).toHaveBeenCalled();
       expect(optimizationCronJobMock.stop).toHaveBeenCalled();
       expect(app.saveAllSettings).toHaveBeenCalled();
       
       // Verify intervals were cleared
       expect(app.memoryMonitorInterval._destroyed).toBe(true);
       
       // Verify logging
       expect(app.log).toHaveBeenCalledWith('Cleanup completed, app is ready to shut down');
     });
     
     it('should handle errors during settings save', async () => {
       const saveError = new Error('Failed to save settings');
       app.saveAllSettings = jest.fn().mockRejectedValue(saveError);
       
       await app.onUninit();
       
       // Verify error was logged
       expect(app.error).toHaveBeenCalledWith(
         'Failed to save settings during shutdown',
         saveError
       );
       
       // Verify other cleanup still happened
       expect(thermalModelServiceMock.stop).toHaveBeenCalled();
       expect(optimizationCronJobMock.stop).toHaveBeenCalled();
     });
   });
   ```

2. **Data Integrity Test**
   - Create a test that simulates app shutdown during operation
   - Restart the app and verify all data is properly loaded
   - Check that no data corruption occurred

## Integration Testing

1. **Full System Test**
   - Run the complete application with all optimizations enabled
   - Simulate normal usage patterns for 48 hours
   - Monitor memory usage, API calls, and data integrity

2. **Error Recovery Test**
   - Simulate various error conditions (API failures, data corruption)
   - Verify the application recovers gracefully
   - Check that appropriate error logs are generated

## Performance Benchmarking

1. **Before/After Comparison**
   - Measure memory usage before implementing optimizations
   - Implement all optimizations
   - Measure memory usage after implementing optimizations
   - Compare results to quantify improvements

2. **Metrics to Compare**
   - Peak memory usage
   - Average memory usage over 24 hours
   - Frequency of garbage collection
   - Time spent in garbage collection
   - Application responsiveness under load