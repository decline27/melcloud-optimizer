// Test script to verify if MELCloud API accepts 0.5°C temperature steps
const https = require('https');

// Configuration - replace with your actual credentials
const config = {
  email: process.env.MELCLOUD_EMAIL,
  password: process.env.MELCLOUD_PASSWORD,
  deviceId: '59132691', // Your boiler device ID
  buildingId: 513523,   // Your building ID
};

// Helper function for HTTP requests
function httpRequest(options, body = null, maxRetries = 3) {
  return new Promise((resolve, reject) => {
    let retryCount = 0;
    
    const makeRequest = () => {
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsedData = JSON.parse(data);
              resolve(parsedData);
            } catch (error) {
              console.error('Error parsing JSON response:', error);
              reject(error);
            }
          } else {
            console.error(`HTTP error: ${res.statusCode} ${res.statusMessage}`);
            console.error('Response data:', data);
            
            // Retry logic for server errors
            if (res.statusCode >= 500 && retryCount < maxRetries) {
              retryCount++;
              console.log(`Retrying request (${retryCount}/${maxRetries})...`);
              setTimeout(makeRequest, 2000 * retryCount); // Exponential backoff
            } else {
              reject(new Error(`HTTP error: ${res.statusCode} ${res.statusMessage}`));
            }
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('Request error:', error);
        
        // Retry logic for network errors
        if (retryCount < maxRetries) {
          retryCount++;
          console.log(`Retrying request (${retryCount}/${maxRetries})...`);
          setTimeout(makeRequest, 2000 * retryCount); // Exponential backoff
        } else {
          reject(error);
        }
      });
      
      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      
      req.end();
    };
    
    makeRequest();
  });
}

// MELCloud API class
class MelCloudApi {
  constructor() {
    this.baseUrl = 'https://app.melcloud.com/Mitsubishi.Wifi.Client/';
    this.contextKey = null;
  }
  
  async login(email, password) {
    try {
      const options = {
        hostname: 'app.melcloud.com',
        path: '/Mitsubishi.Wifi.Client/Login/ClientLogin',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      };
      
      const body = {
        Email: email,
        Password: password,
        Language: 0,
        AppVersion: '1.23.4.0',
        Persist: true,
        CaptchaResponse: null,
      };
      
      const data = await httpRequest(options, body);
      
      if (data.ErrorId !== null) {
        throw new Error(`MELCloud login failed: ${data.ErrorMessage}`);
      }
      
      this.contextKey = data.LoginData.ContextKey;
      console.log('Successfully logged in to MELCloud');
      return true;
    } catch (error) {
      console.error('MELCloud login error:', error);
      throw error;
    }
  }
  
  async getDeviceState(deviceId, buildingId) {
    if (!this.contextKey) {
      throw new Error('Not logged in to MELCloud');
    }
    
    try {
      const options = {
        hostname: 'app.melcloud.com',
        path: `/Mitsubishi.Wifi.Client/Device/Get?id=${deviceId}&buildingID=${buildingId}`,
        method: 'GET',
        headers: {
          'X-MitsContextKey': this.contextKey,
        }
      };
      
      const data = await httpRequest(options);
      
      // Handle different device types
      if (data.SetTemperatureZone1 !== undefined) {
        // This is an ATW device (like a boiler)
        console.log(`Got state for ATW device ${deviceId}: Zone1 temp ${data.SetTemperatureZone1}°C`);
      } else {
        // This is a regular device
        console.log(`Got state for device ${deviceId}: Room temp ${data.RoomTemperature || 'N/A'}°C, Set temp ${data.SetTemperature || 'N/A'}°C`);
      }
      
      return data;
    } catch (error) {
      console.error(`MELCloud get device state error for device ${deviceId}:`, error);
      throw error;
    }
  }
  
  async setDeviceTemperature(deviceId, buildingId, temperature) {
    try {
      if (!this.contextKey) {
        throw new Error('Not logged in to MELCloud');
      }
      
      console.log(`Setting temperature for device ${deviceId} to ${temperature}°C (without rounding)...`);
      
      // Get current state
      const currentState = await this.getDeviceState(deviceId, buildingId);
      
      // For ATW devices (like boilers)
      if (currentState.SetTemperatureZone1 !== undefined) {
        // Create a complete copy of the current state
        const completeRequestBody = JSON.parse(JSON.stringify(currentState));
        
        // Only modify the Zone1 temperature - using exact value without rounding
        completeRequestBody.SetTemperatureZone1 = parseFloat(temperature);
        
        // Ensure these critical fields are set
        completeRequestBody.HasPendingCommand = true;
        // Set the correct effective flags for Zone1 temperature change
        completeRequestBody.EffectiveFlags = 0x200000080; // 8589934720
        completeRequestBody.Power = true;
        completeRequestBody.IdleZone1 = false; // Make sure Zone1 is not idle
        
        console.log('Using Device/SetAtw endpoint with complete device state');
        console.log(`Setting temperature to exactly: ${temperature}°C (${typeof temperature})`);
        
        // Log the request body for debugging (truncated to avoid huge logs)
        console.log('SetAtw request body (truncated):', JSON.stringify(completeRequestBody).substring(0, 200) + '...');
        
        const options = {
          hostname: 'app.melcloud.com',
          path: '/Mitsubishi.Wifi.Client/Device/SetAtw',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-MitsContextKey': this.contextKey,
          }
        };
        
        const data = await httpRequest(options, completeRequestBody);
        
        // Verify that the temperature was actually set by checking the response
        console.log('Response from SetAtw:', JSON.stringify(data).substring(0, 500));
        
        // Check if the response indicates success
        if (data) {
          // The response might contain different fields, so we'll check a few possibilities
          const actualTemp = data.SetTemperatureZone1 || data.SetTemperature;
          
          if (actualTemp !== undefined) {
            console.log(`API returned temperature: ${actualTemp}°C (${typeof actualTemp})`);
            
            // Check if the temperature was set correctly (with a small tolerance for floating point comparison)
            const tempDiff = Math.abs(actualTemp - parseFloat(temperature));
            if (tempDiff < 0.01) {
              console.log(`SUCCESS: Temperature was set to ${actualTemp}°C as requested (${temperature}°C)`);
              return true;
            } else {
              console.log(`WARNING: Attempted to set temperature to ${temperature}°C but API returned ${actualTemp}°C`);
              console.log('Full response data:', JSON.stringify(data).substring(0, 500));
              return false;
            }
          } else {
            // If we can't find the temperature in the response, assume success if the API didn't return an error
            console.log(`Temperature change request accepted, but could not verify the new temperature in the response`);
            console.log('Full response data:', JSON.stringify(data).substring(0, 500));
            return true;
          }
        } else {
          console.log(`WARNING: API returned null or undefined response`);
          return false;
        }
      } else {
        console.log('This is not an ATW device - test not applicable');
        return false;
      }
    } catch (error) {
      console.error(`MELCloud set temperature error for device ${deviceId}:`, error);
      throw error;
    }
  }
}

// Main test function
async function runTest() {
  try {
    console.log('Starting MELCloud 0.5°C temperature step test');
    
    // Check if credentials are provided
    if (!process.env.MELCLOUD_EMAIL || !process.env.MELCLOUD_PASSWORD) {
      console.error('ERROR: Please set MELCLOUD_EMAIL and MELCLOUD_PASSWORD environment variables');
      process.exit(1);
    }
    
    const api = new MelCloudApi();
    
    // Login to MELCloud
    await api.login(config.email, config.password);
    
    // Get current device state
    const deviceState = await api.getDeviceState(config.deviceId, config.buildingId);
    
    // Get current temperature
    const currentTemp = deviceState.SetTemperatureZone1;
    console.log(`Current temperature: ${currentTemp}°C`);
    
    // Calculate test temperature (current + 0.5 or current - 0.5)
    // Make sure we stay within reasonable limits
    let testTemp;
    if (Math.floor(currentTemp) === currentTemp) {
      // If current temp is a whole number, add 0.5
      testTemp = currentTemp + 0.5;
    } else {
      // If current temp already has decimal part, subtract 0.5
      testTemp = Math.floor(currentTemp);
    }
    
    // Ensure test temperature is within reasonable range
    testTemp = Math.max(18, Math.min(24, testTemp));
    
    console.log(`Test temperature: ${testTemp}°C`);
    
    // Try to set the temperature with 0.5°C precision
    const success = await api.setDeviceTemperature(config.deviceId, config.buildingId, testTemp);
    
    if (success) {
      console.log('Test completed successfully!');
      
      // Get the device state again to verify
      const newDeviceState = await api.getDeviceState(config.deviceId, config.buildingId);
      const newTemp = newDeviceState.SetTemperatureZone1;
      
      console.log(`Final temperature according to API: ${newTemp}°C`);
      
      // Check if the temperature was set with 0.5°C precision
      const tempDiff = Math.abs(newTemp - testTemp);
      if (tempDiff < 0.01) {
        console.log('CONCLUSION: MELCloud API DOES support 0.5°C temperature steps!');
      } else {
        console.log(`CONCLUSION: MELCloud API does NOT support 0.5°C temperature steps. It rounded to ${newTemp}°C`);
      }
    } else {
      console.log('Test failed - could not set temperature');
    }
    
    // Set temperature back to original if needed
    if (Math.abs(deviceState.SetTemperatureZone1 - testTemp) > 0.01) {
      console.log(`Setting temperature back to original: ${deviceState.SetTemperatureZone1}°C`);
      await api.setDeviceTemperature(config.deviceId, config.buildingId, deviceState.SetTemperatureZone1);
    }
    
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
runTest();
