// We can't import the TypeScript services directly in the API
// Instead, we'll implement simplified versions of the services here

// Import the HTTPS module
const https = require('https');

// Helper function for making HTTP requests with retry capability
async function httpRequest(options, data = null, maxRetries = 3, retryDelay = 1000) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      // If this is a retry, log it
      if (attempt > 1) {
        console.log(`Retry attempt ${attempt - 1}/${maxRetries} for ${options.method} request to ${options.hostname}${options.path}`);
      } else {
        console.log(`Making ${options.method} request to ${options.hostname}${options.path}`);
      }

      // Create a new promise for this attempt
      const result = await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let responseData = '';

          // Log response status
          console.log(`Response status: ${res.statusCode} ${res.statusMessage}`);

          res.on('data', (chunk) => {
            responseData += chunk;
          });

          res.on('end', () => {
            // Check if we got a redirect
            if (res.statusCode >= 300 && res.statusCode < 400) {
              const location = res.headers.location;
              console.log(`Received redirect to: ${location}`);
              reject(new Error(`Received redirect to: ${location}`));
              return;
            }

            // Check if we got an error
            if (res.statusCode >= 400) {
              console.log(`Error response: ${responseData.substring(0, 200)}...`);
              reject(new Error(`HTTP error ${res.statusCode}: ${res.statusMessage}`));
              return;
            }

            // Try to parse as JSON
            try {
              // Log first 100 chars of response for debugging
              console.log(`Response data (first 100 chars): ${responseData.substring(0, 100)}...`);

              const parsedData = JSON.parse(responseData);
              resolve(parsedData);
            } catch (error) {
              console.log(`Failed to parse response as JSON. First 200 chars: ${responseData.substring(0, 200)}...`);
              reject(new Error(`Failed to parse response: ${error.message}`));
            }
          });
        });

        req.on('error', (error) => {
          console.log(`Request error: ${error.message}`);
          reject(error);
        });

        // Set a timeout to prevent hanging requests
        req.setTimeout(30000, () => {
          req.destroy();
          reject(new Error('Request timeout after 30 seconds'));
        });

        if (data) {
          const dataStr = JSON.stringify(data);
          console.log(`Request data: ${dataStr.substring(0, 100)}...`);
          req.write(dataStr);
        }

        req.end();
      });

      // If we get here, the request was successful
      return result;

    } catch (error) {
      lastError = error;

      // Determine if we should retry based on the error
      const isRetryable = (
        // Network errors are retryable
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENETUNREACH' ||
        // Timeout errors are retryable
        error.message.includes('timeout') ||
        // Some HTTP errors are retryable (e.g., 500, 502, 503, 504)
        (error.message.includes('HTTP error') &&
         (error.message.includes('500') ||
          error.message.includes('502') ||
          error.message.includes('503') ||
          error.message.includes('504')))
      );

      // If this error is not retryable, or we've used all our retries, throw the error
      if (!isRetryable || attempt > maxRetries) {
        console.log(`Request failed after ${attempt} attempt(s): ${error.message}`);
        throw error;
      }

      // Wait before retrying
      console.log(`Waiting ${retryDelay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));

      // Increase the delay for the next retry (exponential backoff)
      retryDelay *= 2;
    }
  }

  // This should never happen, but just in case
  throw lastError || new Error('Request failed for unknown reason');
}

// MELCloud API Service
class MelCloudApi {
  constructor() {
    this.baseUrl = 'https://app.melcloud.com/Mitsubishi.Wifi.Client/';
    this.contextKey = null;
    this.devices = [];
  }

  async login(email, password) {
    try {
      console.log('Logging in to MELCloud...');

      // Make the actual API call to MELCloud
      const baseUrlObj = new URL(this.baseUrl);
      const data = {
        Email: email,
        Password: password,
        Language: 0,
        AppVersion: '1.23.4.0',
        Persist: true,
        CaptchaResponse: null,
      };

      const options = {
        hostname: baseUrlObj.hostname,
        path: '/Mitsubishi.Wifi.Client/Login/ClientLogin',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      // Use the httpRequest function
      const response = await httpRequest(options, data);

      if (response.ErrorId !== null && response.ErrorId !== undefined) {
        throw new Error(`MELCloud login failed: ${response.ErrorMessage}`);
      }

      this.contextKey = response.LoginData.ContextKey;
      console.log('Successfully logged in to MELCloud');
      return true;
    } catch (error) {
      console.error('MELCloud login error:', error);
      throw error;
    }
  }

  async getDevices() {
    try {
      if (!this.contextKey) {
        throw new Error('Not logged in to MELCloud');
      }

      console.log('Getting devices from MELCloud...');

      // Make the actual API call to MELCloud
      const baseUrlObj = new URL(this.baseUrl);
      const options = {
        hostname: baseUrlObj.hostname,
        path: '/Mitsubishi.Wifi.Client/User/ListDevices',
        method: 'GET',
        headers: {
          'X-MitsContextKey': this.contextKey,
          'Accept': 'application/json'
        }
      };

      const data = await httpRequest(options);

      this.devices = this.extractDevices(data);
      console.log(`Found ${this.devices.length} devices in MELCloud account`);
      return this.devices;
    } catch (error) {
      console.error('MELCloud get devices error:', error);
      throw error;
    }
  }

  extractDevices(data) {
    const devices = [];

    // Log the raw data structure for debugging
    console.log('MELCloud API response structure:', JSON.stringify(data).substring(0, 500) + '...');

    // Check if data is an array
    if (!Array.isArray(data)) {
      console.log('MELCloud API response is not an array. Using as a single building.');
      data = [data];
    }

    // Process each building
    data.forEach(building => {
      console.log(`Building: ${building.Name || 'Unknown'} (ID: ${building.ID || 'Unknown'})`);

      // Log the building structure for debugging
      console.log(`Building structure keys: ${Object.keys(building).join(', ')}`);

      // Deep search for devices in the building object
      const foundDevices = this.findDevicesInObject(building, building.ID);

      if (foundDevices.length > 0) {
        console.log(`Found ${foundDevices.length} devices in building ${building.Name || 'Unknown'}`);
        devices.push(...foundDevices);
      } else {
        console.log(`No devices found in building ${building.Name || 'Unknown'}. Creating a dummy device for testing.`);
        // Create a dummy device using the building ID
        const dummyDeviceId = 123456; // Use a fixed ID for consistency
        devices.push({
          id: dummyDeviceId,
          name: 'Dummy Heat Pump',
          buildingId: building.ID,
          type: 'heat_pump',
          data: {
            DeviceID: dummyDeviceId,
            DeviceName: 'Dummy Heat Pump',
            BuildingID: building.ID,
            RoomTemperature: 21.0,
            SetTemperature: 21.0,
            Power: true,
            OperationMode: 1
          },
          isDummy: true
        });
      }
    });

    return devices;
  }

  // Helper method to recursively find devices in an object
  findDevicesInObject(obj, buildingId, path = '') {
    const devices = [];

    // If this is null or not an object, return empty array
    if (!obj || typeof obj !== 'object') {
      return devices;
    }

    // If this is an array, search each item
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        const foundDevices = this.findDevicesInObject(item, buildingId, `${path}[${index}]`);
        devices.push(...foundDevices);
      });
      return devices;
    }

    // Check if this object looks like a device
    if (obj.DeviceID !== undefined && obj.DeviceName !== undefined) {
      console.log(`Found device at ${path}: ${obj.DeviceName} (ID: ${obj.DeviceID})`);
      devices.push({
        id: obj.DeviceID,
        name: obj.DeviceName || `Device ${obj.DeviceID}`,
        buildingId: buildingId,
        type: 'heat_pump',
        data: obj,
      });
    }

    // Check if this is a device list
    if (obj.Devices && Array.isArray(obj.Devices)) {
      console.log(`Found device list at ${path} with ${obj.Devices.length} devices`);
      obj.Devices.forEach(device => {
        if (device.DeviceID !== undefined) {
          console.log(`  Device: ${device.DeviceName || 'Unknown'} (ID: ${device.DeviceID})`);
          devices.push({
            id: device.DeviceID,
            name: device.DeviceName || `Device ${device.DeviceID}`,
            buildingId: buildingId,
            type: 'heat_pump',
            data: device,
          });
        }
      });
    }

    // Recursively search all properties
    Object.keys(obj).forEach(key => {
      // Skip some common properties that are unlikely to contain devices
      if (['ID', 'Name', 'Address', 'City', 'Country', 'PostalCode', 'Icon', 'Latitude', 'Longitude'].includes(key)) {
        return;
      }

      const foundDevices = this.findDevicesInObject(obj[key], buildingId, `${path}.${key}`);
      devices.push(...foundDevices);
    });

    return devices;
  }

  /**
   * Find a device by name or ID
   * @param {string|number} deviceIdentifier - Device name or ID
   * @param {number} [buildingId] - Optional building ID to filter by
   * @returns {Object} - Device object with id, name, buildingId, and data properties
   */
  findDevice(deviceIdentifier, buildingId = null) {
    // Make sure we have devices
    if (this.devices.length === 0) {
      throw new Error('No devices found in MELCloud account. Please check your MELCloud credentials.');
    }

    let device = null;

    // First try to find by exact ID match
    if (!isNaN(parseInt(deviceIdentifier))) {
      device = this.devices.find(d => d.id.toString() === deviceIdentifier.toString());
      if (device) {
        console.log(`Found device with ID ${deviceIdentifier}: ${device.name} (Building ID: ${device.buildingId})`);
        return device;
      }
    }

    // Then try to find by name (case-insensitive)
    if (typeof deviceIdentifier === 'string') {
      device = this.devices.find(d =>
        d.name.toLowerCase() === deviceIdentifier.toLowerCase() &&
        (buildingId === null || d.buildingId.toString() === buildingId.toString())
      );
      if (device) {
        console.log(`Found device with name ${deviceIdentifier}: ID=${device.id}, BuildingID=${device.buildingId}`);
        return device;
      }
    }

    // If we have a building ID, try to find any device in that building
    if (buildingId !== null) {
      device = this.devices.find(d => d.buildingId.toString() === buildingId.toString());
      if (device) {
        console.log(`No exact match found. Using device from building ${buildingId}: ${device.name} (ID: ${device.id})`);
        return device;
      }
    }

    // If all else fails, use the first device
    device = this.devices[0];
    console.log(`No matching device found. Using first available device: ${device.name} (ID: ${device.id}, Building ID: ${device.buildingId})`);
    return device;
  }

  async getDeviceState(deviceId, buildingId) {
    try {
      if (!this.contextKey) {
        throw new Error('Not logged in to MELCloud');
      }

      // Find the device using our new helper method
      const device = this.findDevice(deviceId, buildingId);
      deviceId = device.id;
      buildingId = device.buildingId;

      // Check if this is a dummy device
      if (device.isDummy) {
        console.log(`Using dummy device data for device ${deviceId}`);
        return device.data;
      }

      console.log(`Getting state for device ${deviceId} in building ${buildingId}...`);

      // Make the actual API call to MELCloud
      const baseUrlObj = new URL(this.baseUrl);
      const path = `/Mitsubishi.Wifi.Client/Device/Get?id=${deviceId}&buildingID=${buildingId}`;

      const options = {
        hostname: baseUrlObj.hostname,
        path: path,
        method: 'GET',
        headers: {
          'X-MitsContextKey': this.contextKey,
          'Accept': 'application/json'
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

  /**
   * Set the temperature for a device
   * @param {string|number} deviceId - Device name or ID
   * @param {number} [buildingId] - Optional building ID
   * @param {number} temperature - The temperature to set
   * @param {number} [maxRetries=2] - Maximum number of retries for setting temperature
   * @returns {Promise<boolean>} - True if successful, false otherwise
   */
  async setDeviceTemperature(deviceId, buildingId, temperature, maxRetries = 2, zone = 1) {
    try {
      if (!this.contextKey) {
        throw new Error('Not logged in to MELCloud');
      }

      console.log(`Setting temperature for device ${deviceId} to ${temperature}°C for Zone${zone}...`);

      // First find the device
      const device = this.findDevice(deviceId, buildingId);
      deviceId = device.id;
      buildingId = device.buildingId;

      // Then get current state
      const currentState = await this.getDeviceState(deviceId, buildingId);

      // Check if this is a dummy device
      if (device.isDummy) {
        console.log(`Using dummy device - simulating temperature change for device ${deviceId}`);
        // Update the dummy device data
        if (zone === 2 && currentState.SetTemperatureZone2 !== undefined) {
          device.data.SetTemperatureZone2 = temperature;
          console.log(`Successfully set Zone2 temperature for dummy device ${deviceId} to ${temperature}°C`);
        } else {
          // Default to Zone1 or main temperature
          if (currentState.SetTemperatureZone1 !== undefined) {
            device.data.SetTemperatureZone1 = temperature;
            console.log(`Successfully set Zone1 temperature for dummy device ${deviceId} to ${temperature}°C`);
          } else {
            device.data.SetTemperature = temperature;
            console.log(`Successfully set temperature for dummy device ${deviceId} to ${temperature}°C`);
          }
        }
        return true;
      }

      // For ATW (Air to Water) devices, we need to set the zone temperature
      if (currentState.SetTemperatureZone1 !== undefined) {
        console.log(`Detected ATW (Air to Water) device, setting Zone${zone} temperature`);

        // Log the current operation modes and other important settings
        console.log(`Current device state:`);
        console.log(`- Power: ${currentState.Power}`);
        console.log(`- OperationMode: ${currentState.OperationMode}`);
        console.log(`- OperationModeZone1: ${currentState.OperationModeZone1}`);
        console.log(`- OperationModeZone2: ${currentState.OperationModeZone2 || 'N/A'}`);
        console.log(`- IdleZone1: ${currentState.IdleZone1}`);
        console.log(`- IdleZone2: ${currentState.IdleZone2 || 'N/A'}`);
        console.log(`- Current Zone1 temp: ${currentState.SetTemperatureZone1}°C`);
        console.log(`- Current Zone2 temp: ${currentState.SetTemperatureZone2 || 'N/A'}°C`);

        // Create a complete copy of the current state
        const completeRequestBody = JSON.parse(JSON.stringify(currentState));

        // Set the temperature for the specified zone
        if (zone === 2 && currentState.SetTemperatureZone2 !== undefined) {
          // Set Zone2 temperature
          completeRequestBody.SetTemperatureZone2 = parseFloat(temperature);
          // Set the correct effective flags for Zone2 temperature change
          // Using the correct flag from pymelcloud: 0x800000200 (34359738880 in decimal)
          completeRequestBody.EffectiveFlags = 0x800000200;
          completeRequestBody.IdleZone2 = false; // Make sure Zone2 is not idle
          console.log(`Setting Zone2 temperature to ${temperature}°C`);
        } else {
          // Set Zone1 temperature (default)
          completeRequestBody.SetTemperatureZone1 = parseFloat(temperature);
          // Set the correct effective flags for Zone1 temperature change
          completeRequestBody.EffectiveFlags = 0x200000080;
          completeRequestBody.IdleZone1 = false; // Make sure Zone1 is not idle
          console.log(`Setting Zone1 temperature to ${temperature}°C`);
        }

        // Ensure these critical fields are set
        completeRequestBody.HasPendingCommand = true;
        completeRequestBody.Power = true;

        console.log('Using Device/SetAtw endpoint with complete device state');

        // Log the request body for debugging (truncated to avoid huge logs)
        console.log('SetAtw request body (truncated):', JSON.stringify(completeRequestBody).substring(0, 200) + '...');

        // Make the actual API call to MELCloud
        const baseUrlObj = new URL(this.baseUrl);
        const options = {
          hostname: baseUrlObj.hostname,
          path: '/Mitsubishi.Wifi.Client/Device/SetAtw',  // Using the original SetAtw endpoint
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-MitsContextKey': this.contextKey,
          }
        };

        // Use the complete request body for the HTTP request with retry
        const data = await httpRequest(options, completeRequestBody, maxRetries);

        // Verify that the temperature was actually set by checking the response
        console.log('Response from SetAtw:', JSON.stringify(data).substring(0, 500));

        // Check if the response indicates success
        if (data) {
          // The response might contain different fields, so we'll check a few possibilities
          const actualTemp = zone === 2 ? data.SetTemperatureZone2 : data.SetTemperatureZone1;

          if (actualTemp !== undefined) {
            if (Math.round(actualTemp) === Math.round(parseFloat(temperature))) {
              console.log(`Successfully set Zone${zone} temperature for device ${completeRequestBody.DeviceID || deviceId} to ${temperature}°C`);
              return true;
            } else {
              console.log(`WARNING: Attempted to set Zone${zone} temperature to ${temperature}°C but API returned ${actualTemp}°C`);
              console.log('Full response data:', JSON.stringify(data).substring(0, 500));
              // Return true anyway since the API accepted the request
              return true;
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
        // For regular devices, set the main temperature
        const requestBody = {
          DeviceID: currentState.DeviceID,
          SetTemperature: parseFloat(temperature), // Using exact value without rounding
          Power: true,
          EffectiveFlags: 1,
          HasPendingCommand: true
        };

        // Make the actual API call to MELCloud
        const baseUrlObj = new URL(this.baseUrl);
        const options = {
          hostname: baseUrlObj.hostname,
          path: '/Mitsubishi.Wifi.Client/Device/SetAta',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-MitsContextKey': this.contextKey,
          }
        };

        // Log the request body for debugging
        console.log('SetAta request body:', JSON.stringify(requestBody));

        // Use the retry mechanism for this request as well
        const data = await httpRequest(options, requestBody, maxRetries);

        // Verify the response
        if (data && data.SetTemperature !== undefined) {
          const actualTemp = data.SetTemperature;
          if (Math.round(actualTemp) === Math.round(parseFloat(temperature))) {
            console.log(`Successfully set temperature for device ${requestBody.DeviceID || deviceId} to ${temperature}°C`);
          } else {
            console.log(`WARNING: Attempted to set temperature to ${temperature}°C but API returned ${actualTemp}°C`);
            console.log('Full response data:', JSON.stringify(data).substring(0, 500));
          }
        } else {
          console.log(`Temperature change request accepted, but could not verify the new temperature in the response`);
          console.log('Response data:', JSON.stringify(data).substring(0, 500));
        }

        return data !== null;
      }
    } catch (error) {
      console.error(`MELCloud set temperature error for device ${deviceId}:`, error);
      throw error; // Re-throw the error to be handled by the caller
    }
  }

  /**
   * Set the tank water temperature for a device
   * @param {string|number} deviceId - Device name or ID
   * @param {number} [buildingId] - Optional building ID
   * @param {number} temperature - The temperature to set
   * @param {number} [maxRetries=2] - Maximum number of retries for setting temperature
   * @returns {Promise<boolean>} - True if successful, false otherwise
   */
  async setDeviceTankTemperature(deviceId, buildingId, temperature, maxRetries = 2) {
    try {
      if (!this.contextKey) {
        throw new Error('Not logged in to MELCloud');
      }

      console.log(`Setting tank water temperature for device ${deviceId} to ${temperature}°C...`);

      // First find the device
      const device = this.findDevice(deviceId, buildingId);
      deviceId = device.id;
      buildingId = device.buildingId;

      // Then get current state
      const currentState = await this.getDeviceState(deviceId, buildingId);

      // Check if this is a dummy device
      if (device.isDummy) {
        console.log(`Using dummy device - simulating tank temperature change for device ${deviceId}`);
        // Update the dummy device data
        device.data.SetTankWaterTemperature = temperature;
        console.log(`Successfully set tank temperature for dummy device ${deviceId} to ${temperature}°C`);
        return true;
      }

      // Only ATW devices have tank water temperature
      if (currentState.SetTankWaterTemperature === undefined) {
        throw new Error('Device does not support tank water temperature');
      }

      console.log('Setting tank water temperature for ATW device');

      // Log the current operation modes and other important settings
      console.log(`Current device state:`);
      console.log(`- Power: ${currentState.Power}`);
      console.log(`- OperationMode: ${currentState.OperationMode}`);
      console.log(`- Current tank water temp: ${currentState.SetTankWaterTemperature}°C`);

      // Create a complete copy of the current state
      const completeRequestBody = JSON.parse(JSON.stringify(currentState));

      // Only modify the tank water temperature - using exact value without rounding
      // MELCloud API can accept 0.5°C increments
      completeRequestBody.SetTankWaterTemperature = parseFloat(temperature);

      // Ensure these critical fields are set
      completeRequestBody.HasPendingCommand = true;
      // Set the correct effective flags for tank water temperature change
      // Using the correct flag from pymelcloud: 0x1000000000020 (17592186044448 in decimal)
      completeRequestBody.EffectiveFlags = 0x1000000000020; // Correct flag for tank temperature
      completeRequestBody.Power = true;

      console.log('Using Device/SetAtw endpoint with complete device state for tank temperature');

      // Log the request body for debugging (truncated to avoid huge logs)
      console.log('SetAtw request body (truncated):', JSON.stringify(completeRequestBody).substring(0, 200) + '...');

      // Make the actual API call to MELCloud
      const baseUrlObj = new URL(this.baseUrl);
      const options = {
        hostname: baseUrlObj.hostname,
        path: '/Mitsubishi.Wifi.Client/Device/SetAtw',  // Using the SetAtw endpoint
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-MitsContextKey': this.contextKey,
        }
      };

      // Use the complete request body for the HTTP request with retry
      const data = await httpRequest(options, completeRequestBody, maxRetries);

      // Verify that the temperature was actually set by checking the response
      console.log('Response from SetAtw:', JSON.stringify(data).substring(0, 500));

      // Check if the response indicates success
      if (data) {
        // The response might contain different fields, so we'll check a few possibilities
        const actualTemp = data.SetTankWaterTemperature;

        if (actualTemp !== undefined) {
          if (Math.round(actualTemp) === Math.round(parseFloat(temperature))) {
            console.log(`Successfully set tank water temperature for device ${completeRequestBody.DeviceID || deviceId} to ${temperature}°C`);
            return true;
          } else {
            console.log(`WARNING: Attempted to set tank water temperature to ${temperature}°C but API returned ${actualTemp}°C`);
            console.log('Full response data:', JSON.stringify(data).substring(0, 500));
            // Return true anyway since the API accepted the request
            return true;
          }
        } else {
          // If we can't find the temperature in the response, assume success if the API didn't return an error
          console.log(`Tank temperature change request accepted, but could not verify the new temperature in the response`);
          console.log('Full response data:', JSON.stringify(data).substring(0, 500));
          return true;
        }
      } else {
        console.log(`WARNING: API returned null or undefined response`);
        return false;
      }
    } catch (error) {
      console.error(`MELCloud set tank temperature error for device ${deviceId}:`, error);
      throw error; // Re-throw the error to be handled by the caller
    }
  }
}

// Tibber API Service
class TibberApi {
  constructor(token) {
    this.token = token;
    this.apiEndpoint = 'https://api.tibber.com/v1-beta/gql';
    this.cachedPrices = null;
    this.lastFetchTime = null;
    this.priceUpdateTime = null; // Time when prices were last updated by Tibber
    this.nextPriceUpdateTime = null; // Next time when prices will be updated (13:00)
  }

  /**
   * Check if we should fetch new prices from Tibber
   * @returns {boolean} - True if we should fetch new prices
   */
  shouldFetchNewPrices() {
    // If we've never fetched prices, we should fetch them
    if (!this.lastFetchTime) return true;

    const now = new Date();

    // If it's been more than 1 hour since last fetch, fetch again
    if ((now - this.lastFetchTime) > 60 * 60 * 1000) return true;

    // If we're approaching the next price update time (13:00), fetch again
    // Check if it's between 12:45 and 13:15
    if (this.nextPriceUpdateTime) {
      const timeDiff = Math.abs(now - this.nextPriceUpdateTime);
      if (timeDiff < 15 * 60 * 1000) return true; // Within 15 minutes of price update
    }

    // If we have cached prices but they don't include the current hour, fetch again
    if (this.cachedPrices && this.cachedPrices.current) {
      const currentPriceTime = new Date(this.cachedPrices.current.time);
      const currentHour = new Date(now);
      currentHour.setMinutes(0, 0, 0);

      if (currentPriceTime < currentHour) return true;
    }

    return false;
  }

  /**
   * Calculate the next price update time (13:00 today or tomorrow)
   * @returns {Date} - Next price update time
   */
  calculateNextPriceUpdateTime() {
    // Use the local time directly
    const now = new Date();
    const today13 = new Date(now);
    today13.setHours(13, 0, 0, 0);

    // If it's already past 13:00 today, the next update is tomorrow at 13:00
    if (now > today13) {
      const tomorrow13 = new Date(today13);
      tomorrow13.setDate(tomorrow13.getDate() + 1);
      return tomorrow13;
    }

    // Otherwise, the next update is today at 13:00
    return today13;
  }

  /**
   * Get electricity prices from Tibber
   * @param {boolean} [forceRefresh=false] - Force a refresh of prices even if we have cached data
   * @returns {Promise<Object>} - Price data
   */
  async getPrices(forceRefresh = false) {
    try {
      // Check if we should use cached prices
      if (!forceRefresh && this.cachedPrices && !this.shouldFetchNewPrices()) {
        console.log('Using cached price data');
        return this.cachedPrices;
      }

      console.log('Fetching fresh prices from Tibber...');

      // Define the GraphQL query
      const query = `{
        viewer {
          homes {
            currentSubscription {
              priceInfo {
                current {
                  total
                  energy
                  tax
                  startsAt
                  level
                }
                today {
                  total
                  energy
                  tax
                  startsAt
                  level
                }
                tomorrow {
                  total
                  energy
                  tax
                  startsAt
                  level
                }
              }
            }
          }
        }
      }`;

      // Make the actual API call to Tibber
      const urlObj = new URL(this.apiEndpoint);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        }
      };

      // Use retry mechanism for Tibber API calls (3 retries with 2000ms initial delay)
      const data = await httpRequest(options, { query }, 3, 2000);

      if (data.errors) {
        throw new Error(`Tibber API error: ${data.errors[0].message}`);
      }

      // Format the price data
      const result = this.formatPriceData(data);
      console.log(`Got current price: ${result.current.price} and ${result.prices.length} future prices`);

      // Update cache and timestamps
      this.cachedPrices = result;
      this.lastFetchTime = new Date();
      this.nextPriceUpdateTime = this.calculateNextPriceUpdateTime();

      // Determine when these prices were last updated by Tibber
      this.determinePriceUpdateTime(result);

      return result;
    } catch (error) {
      console.error('Tibber API error:', error);

      // If we have cached prices, return them as a fallback
      if (this.cachedPrices) {
        console.log('Using cached prices as fallback due to API error');
        return this.cachedPrices;
      }

      throw error;
    }
  }

  /**
   * Determine when the prices were last updated by Tibber
   * @param {Object} priceData - Price data from Tibber
   */
  determinePriceUpdateTime(priceData) {
    if (!priceData || !priceData.prices || priceData.prices.length === 0) return;

    // Find the earliest price for tomorrow
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const tomorrowPrices = priceData.prices.filter(p => new Date(p.time) >= tomorrow);

    if (tomorrowPrices.length > 0) {
      // If we have prices for tomorrow, they were updated today at 13:00
      const today13 = new Date(now);
      today13.setHours(13, 0, 0, 0);
      this.priceUpdateTime = today13;
    } else {
      // If we don't have prices for tomorrow, they were updated yesterday at 13:00
      const yesterday13 = new Date(now);
      yesterday13.setDate(yesterday13.getDate() - 1);
      yesterday13.setHours(13, 0, 0, 0);
      this.priceUpdateTime = yesterday13;
    }

    console.log(`Prices were last updated at: ${this.priceUpdateTime.toISOString()}`);
    console.log(`Next price update expected at: ${this.nextPriceUpdateTime.toISOString()}`);
  }

  /**
   * Format and analyze price data from Tibber API
   * @param {Object} data - Raw data from Tibber API
   * @returns {Object} - Formatted and analyzed price data
   */
  formatPriceData(data) {
    const homes = data.data.viewer.homes;
    if (!homes || homes.length === 0) {
      throw new Error('No homes found in Tibber account');
    }

    const priceInfo = homes[0].currentSubscription?.priceInfo;
    if (!priceInfo) {
      throw new Error('No price information available');
    }

    // Combine today and tomorrow prices
    const prices = [
      ...(priceInfo.today || []),
      ...(priceInfo.tomorrow || []),
    ].map(price => ({
      time: price.startsAt,
      price: price.total,
      level: price.level || 'NORMAL', // Default to NORMAL if level is not provided
    }));

    // Sort prices by time
    prices.sort((a, b) => new Date(a.time) - new Date(b.time));

    // Get current price
    const current = priceInfo.current ? {
      time: priceInfo.current.startsAt,
      price: priceInfo.current.total,
      level: priceInfo.current.level || 'NORMAL', // Default to NORMAL if level is not provided
    } : null;

    // Log the price level from Tibber
    if (current && current.level) {
      console.log(`Current Tibber price level: ${current.level}`);
    }

    // Calculate price statistics
    const priceValues = prices.map(p => p.price);
    const priceStats = this.calculatePriceStatistics(priceValues);

    // Identify price peaks and valleys
    const pricePatterns = this.identifyPricePatterns(prices);

    // Group prices by day
    const pricesByDay = this.groupPricesByDay(prices);

    // Create the final result object
    return {
      current,
      prices,
      statistics: priceStats,
      patterns: pricePatterns,
      byDay: pricesByDay,
      forecast: this.createPriceForecast(prices, current)
    };
  }

  /**
   * Calculate statistics for price data
   * @param {Array<number>} prices - Array of price values
   * @returns {Object} - Price statistics
   */
  calculatePriceStatistics(prices) {
    if (!prices || prices.length === 0) {
      return {
        min: 0,
        max: 0,
        avg: 0,
        median: 0,
        stdDev: 0
      };
    }

    // Sort prices for percentile calculations
    const sortedPrices = [...prices].sort((a, b) => a - b);

    // Calculate basic statistics
    const min = sortedPrices[0];
    const max = sortedPrices[sortedPrices.length - 1];
    const sum = sortedPrices.reduce((acc, price) => acc + price, 0);
    const avg = sum / sortedPrices.length;

    // Calculate median
    const mid = Math.floor(sortedPrices.length / 2);
    const median = sortedPrices.length % 2 === 0 ?
      (sortedPrices[mid - 1] + sortedPrices[mid]) / 2 :
      sortedPrices[mid];

    // Calculate standard deviation
    const squaredDiffs = sortedPrices.map(price => Math.pow(price - avg, 2));
    const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / sortedPrices.length;
    const stdDev = Math.sqrt(variance);

    // Calculate percentiles
    const p25 = sortedPrices[Math.floor(sortedPrices.length * 0.25)];
    const p75 = sortedPrices[Math.floor(sortedPrices.length * 0.75)];

    return {
      min,
      max,
      avg,
      median,
      stdDev,
      p25,
      p75,
      range: max - min,
      volatility: stdDev / avg // Coefficient of variation as volatility measure
    };
  }

  /**
   * Identify price patterns (peaks and valleys)
   * @param {Array<Object>} prices - Array of price objects with time and price
   * @returns {Object} - Price patterns
   */
  identifyPricePatterns(prices) {
    if (!prices || prices.length < 3) {
      return { peaks: [], valleys: [], trends: [] };
    }

    const peaks = [];
    const valleys = [];
    const trends = [];

    // Find local peaks and valleys
    for (let i = 1; i < prices.length - 1; i++) {
      const prev = prices[i-1].price;
      const curr = prices[i].price;
      const next = prices[i+1].price;

      // Local peak
      if (curr > prev && curr > next) {
        peaks.push({
          time: prices[i].time,
          price: curr,
          index: i
        });
      }

      // Local valley
      if (curr < prev && curr < next) {
        valleys.push({
          time: prices[i].time,
          price: curr,
          index: i
        });
      }
    }

    // Identify significant trends (consecutive increases or decreases)
    let currentTrend = { direction: null, start: 0, count: 0, startPrice: prices[0].price };

    for (let i = 1; i < prices.length; i++) {
      const priceDiff = prices[i].price - prices[i-1].price;
      const direction = priceDiff > 0 ? 'up' : priceDiff < 0 ? 'down' : 'flat';

      if (currentTrend.direction === null) {
        // Start a new trend
        currentTrend = {
          direction,
          start: i-1,
          count: 1,
          startPrice: prices[i-1].price,
          startTime: prices[i-1].time
        };
      } else if (direction === currentTrend.direction || direction === 'flat') {
        // Continue the current trend
        currentTrend.count++;
      } else {
        // End the current trend if it's significant (3+ hours)
        if (currentTrend.count >= 2) {
          trends.push({
            direction: currentTrend.direction,
            startIndex: currentTrend.start,
            endIndex: i-1,
            startTime: currentTrend.startTime,
            endTime: prices[i-1].time,
            startPrice: currentTrend.startPrice,
            endPrice: prices[i-1].price,
            duration: currentTrend.count + 1,
            priceChange: prices[i-1].price - currentTrend.startPrice,
            percentChange: ((prices[i-1].price - currentTrend.startPrice) / currentTrend.startPrice) * 100
          });
        }

        // Start a new trend
        currentTrend = {
          direction,
          start: i-1,
          count: 1,
          startPrice: prices[i-1].price,
          startTime: prices[i-1].time
        };
      }
    }

    // Add the final trend if it's significant
    if (currentTrend.count >= 2) {
      const lastIndex = prices.length - 1;
      trends.push({
        direction: currentTrend.direction,
        startIndex: currentTrend.start,
        endIndex: lastIndex,
        startTime: currentTrend.startTime,
        endTime: prices[lastIndex].time,
        startPrice: currentTrend.startPrice,
        endPrice: prices[lastIndex].price,
        duration: currentTrend.count + 1,
        priceChange: prices[lastIndex].price - currentTrend.startPrice,
        percentChange: ((prices[lastIndex].price - currentTrend.startPrice) / currentTrend.startPrice) * 100
      });
    }

    return { peaks, valleys, trends };
  }

  /**
   * Group prices by day
   * @param {Array<Object>} prices - Array of price objects with time and price
   * @returns {Object} - Prices grouped by day
   */
  groupPricesByDay(prices) {
    if (!prices || prices.length === 0) return {};

    const pricesByDay = {};

    prices.forEach(price => {
      const date = new Date(price.time);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD

      if (!pricesByDay[dateKey]) {
        pricesByDay[dateKey] = [];
      }

      pricesByDay[dateKey].push(price);
    });

    // Calculate statistics for each day
    Object.keys(pricesByDay).forEach(day => {
      const dayPrices = pricesByDay[day];
      const priceValues = dayPrices.map(p => p.price);

      pricesByDay[day] = {
        prices: dayPrices,
        statistics: this.calculatePriceStatistics(priceValues),
        patterns: this.identifyPricePatterns(dayPrices)
      };
    });

    return pricesByDay;
  }

  /**
   * Create a price forecast with recommendations
   * @param {Array<Object>} prices - Array of price objects
   * @param {Object} currentPrice - Current price object
   * @returns {Object} - Price forecast with recommendations
   */
  createPriceForecast(prices, currentPrice) {
    if (!prices || prices.length === 0 || !currentPrice) {
      return { recommendation: 'No price data available for forecasting' };
    }

    // Get current time and price using local time
    const now = new Date();
    // Use the current hour from local time to find the current price period
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Find the price that matches the current hour
    const currentTime = new Date(currentPrice.time);
    const currentPriceValue = currentPrice.price;

    console.log(`Using local time for price forecast: ${now.toString()} (Hour: ${currentHour}:${currentMinute < 10 ? '0' + currentMinute : currentMinute})`);
    console.log(`Current price time from Tibber: ${currentTime.toString()}`);

    // Filter future prices (from current hour onwards)
    const futurePrices = prices.filter(p => {
      const priceTime = new Date(p.time);
      // Compare using local time hours
      return priceTime.getHours() > currentHour ||
             (priceTime.getHours() === currentHour && priceTime.getDate() > now.getDate());
    });

    if (futurePrices.length === 0) {
      return { recommendation: 'No future price data available' };
    }

    // Calculate statistics for future prices
    const futurePriceValues = futurePrices.map(p => p.price);
    const futureStats = this.calculatePriceStatistics(futurePriceValues);

    // Determine if current price is high, medium, or low using Tibber's price level
    const pricePosition = this.determinePricePosition(currentPriceValue, futureStats, currentPrice.level);

    // Find upcoming significant price changes
    const upcomingChanges = this.findUpcomingPriceChanges(futurePrices, currentPriceValue);

    // Find best and worst times to use electricity in next 24 hours
    const next24Hours = futurePrices.filter(p => {
      const time = new Date(p.time);
      return (time - now) <= 24 * 60 * 60 * 1000;
    });

    const bestTimes = this.findBestTimes(next24Hours, 3);
    const worstTimes = this.findWorstTimes(next24Hours, 3);

    // Generate recommendation
    let recommendation = '';

    if (pricePosition === 'low') {
      recommendation = 'Current price is low compared to upcoming prices. Consider increasing energy usage now.';
    } else if (pricePosition === 'high') {
      recommendation = 'Current price is high compared to upcoming prices. Consider reducing energy usage now.';
    } else {
      recommendation = 'Current price is average compared to upcoming prices. Normal energy usage recommended.';
    }

    if (upcomingChanges.significant) {
      recommendation += ` ${upcomingChanges.message}`;
    }

    return {
      currentPosition: pricePosition,
      recommendation,
      upcomingChanges,
      bestTimes,
      worstTimes,
      futureStats
    };
  }

  /**
   * Determine if current price is high, medium, or low based on Tibber's price level
   * @param {number} currentPrice - Current price (not used if level is provided)
   * @param {Object} stats - Price statistics (not used if level is provided)
   * @param {string} [level] - Tibber price level (VERY_CHEAP, CHEAP, NORMAL, EXPENSIVE, VERY_EXPENSIVE)
   * @returns {string} - Price position ('low', 'medium', or 'high')
   */
  determinePricePosition(currentPrice, stats, level) {
    // If Tibber price level is provided, use it
    if (level) {
      console.log(`Using Tibber price level: ${level} to determine price position`);

      // Map Tibber price levels to our price positions
      switch (level) {
        case 'VERY_CHEAP':
        case 'CHEAP':
          return 'low';
        case 'NORMAL':
          return 'medium';
        case 'EXPENSIVE':
        case 'VERY_EXPENSIVE':
          return 'high';
        default:
          console.log(`Unknown Tibber price level: ${level}, falling back to relative calculation`);
          // Fall back to relative calculation if level is unknown
      }
    }

    // Fall back to our original calculation if no level is provided or it's unknown
    const { p25, p75 } = stats;

    if (currentPrice <= p25) return 'low';
    if (currentPrice >= p75) return 'high';
    return 'medium';
  }

  /**
   * Find upcoming significant price changes
   * @param {Array<Object>} prices - Array of price objects
   * @param {number} currentPrice - Current price
   * @returns {Object} - Information about upcoming price changes
   */
  findUpcomingPriceChanges(prices, currentPrice) {
    if (prices.length < 2) return { significant: false };

    // Look at the next few hours
    const nextFewHours = prices.slice(0, Math.min(6, prices.length));

    // Calculate the maximum price change in the next few hours
    let maxChange = 0;
    let maxChangeTime = null;
    let maxChangePercent = 0;

    for (let i = 0; i < nextFewHours.length; i++) {
      const change = nextFewHours[i].price - currentPrice;
      const changePercent = (change / currentPrice) * 100;

      if (Math.abs(change) > Math.abs(maxChange)) {
        maxChange = change;
        maxChangeTime = nextFewHours[i].time;
        maxChangePercent = changePercent;
      }
    }

    // Determine if the change is significant (more than 15%)
    const isSignificant = Math.abs(maxChangePercent) >= 15;

    let message = '';
    if (isSignificant) {
      const direction = maxChange > 0 ? 'increase' : 'decrease';
      // Use local time formatting
      const changeTimeDate = new Date(maxChangeTime);
      const timeStr = changeTimeDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      message = `Significant price ${direction} of ${Math.abs(maxChangePercent).toFixed(1)}% expected at ${timeStr}.`;
    }

    return {
      significant: isSignificant,
      change: maxChange,
      changePercent: maxChangePercent,
      time: maxChangeTime,
      message
    };
  }

  /**
   * Find the best times (lowest prices) in the given period
   * @param {Array<Object>} prices - Array of price objects
   * @param {number} count - Number of times to return
   * @returns {Array<Object>} - Best times to use electricity
   */
  findBestTimes(prices, count) {
    if (!prices || prices.length === 0) return [];

    // Sort by price (ascending)
    const sorted = [...prices].sort((a, b) => a.price - b.price);

    // Take the top 'count' entries
    return sorted.slice(0, count).map(p => {
      const priceTime = new Date(p.time);
      return {
        time: p.time,
        price: p.price,
        timeFormatted: priceTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
    });
  }

  /**
   * Find the worst times (highest prices) in the given period
   * @param {Array<Object>} prices - Array of price objects
   * @param {number} count - Number of times to return
   * @returns {Array<Object>} - Worst times to use electricity
   */
  findWorstTimes(prices, count) {
    if (!prices || prices.length === 0) return [];

    // Sort by price (descending)
    const sorted = [...prices].sort((a, b) => b.price - a.price);

    // Take the top 'count' entries
    return sorted.slice(0, count).map(p => {
      const priceTime = new Date(p.time);
      return {
        time: p.time,
        price: p.price,
        timeFormatted: priceTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
    });
  }
}

// OpenAI API Service
class OpenAiApi {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.apiEndpoint = 'https://api.openai.com/v1/chat/completions';
  }

  async analyzeData(data) {
    try {
      console.log('Analyzing data with OpenAI...');

      // Prepare the prompt with the data
      const prompt = this.preparePrompt(data);

      // Make the API call to OpenAI
      const body = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant that helps optimize heating systems based on electricity prices and temperature data.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      };

      const urlObj = new URL(this.apiEndpoint);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        }
      };

      // Use retry mechanism for OpenAI API calls (2 retries with 3000ms initial delay)
      // OpenAI API can sometimes be slow or have rate limits
      const result = await httpRequest(options, body, 2, 3000);

      if (!result.choices || result.choices.length === 0) {
        throw new Error('OpenAI API returned no choices');
      }

      // Extract the analysis from the response
      const analysis = result.choices[0].message.content;
      console.log('OpenAI analysis:', analysis);

      // Parse the analysis to extract the recommended K factor
      const kFactor = this.extractKFactor(analysis);

      return {
        analysis,
        kFactor
      };
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw error;
    }
  }

  preparePrompt(data) {
    // Create a prompt with the data for OpenAI to analyze
    return `
I need help calibrating a heat pump optimization system. Here's the data from the past week:

${JSON.stringify(data, null, 2)}

Based on this data, please analyze:
1. How well the current thermal model (K factor) is performing
2. What adjustments should be made to the K factor
3. Recommend a specific new K factor value (a number between 0.1 and 1.0)
4. Any other insights or recommendations

Please format your response with clear sections and include a specific recommended K factor value that I can extract programmatically.
`;
  }

  extractKFactor(analysis) {
    // Try to extract the K factor from the analysis
    try {
      // Look for patterns like "recommended K factor: 0.45" or "K factor: 0.45"
      const kFactorRegex = /[Kk]\s*factor\s*:?\s*([0-9]\.[0-9]+)/;
      const match = analysis.match(kFactorRegex);

      if (match && match[1]) {
        const kFactor = parseFloat(match[1]);

        // Validate the K factor is in a reasonable range
        if (kFactor >= 0.1 && kFactor <= 1.0) {
          return kFactor;
        }
      }

      // If we couldn't extract a valid K factor, return a default value
      return 0.5;
    } catch (error) {
      console.error('Error extracting K factor:', error);
      return 0.5; // Default value
    }
  }


}

// Optimizer Service
class Optimizer {
  constructor(melCloud, tibber, deviceId, buildingId, logger, openai, weather = null) {
    this.melCloud = melCloud;
    this.tibber = tibber;
    this.deviceId = deviceId;
    this.buildingId = buildingId;
    this.logger = logger;
    this.openai = openai;
    this.weather = weather; // Weather API instance
    this.thermalModel = { K: 0.5 };

    // Heating temperature settings for Zone1
    this.minTemp = 18;
    this.maxTemp = 22;
    this.tempStep = 0.5;

    // Heating temperature settings for Zone2
    this.enableZone2 = false;
    this.minTempZone2 = 18;
    this.maxTempZone2 = 22;
    this.tempStepZone2 = 0.5;

    // Hot water tank temperature settings
    this.enableTankControl = false;
    this.minTankTemp = 40;
    this.maxTankTemp = 50;
    this.tankTempStep = 1.0;

    this.useWeatherData = weather !== null;
  }

  /**
   * Set the Weather API instance
   * @param {Object} weatherApi - Weather API instance
   */
  setWeatherApi(weatherApi) {
    this.weather = weatherApi;
    this.useWeatherData = weatherApi !== null;
    this.logger.log('Weather API integration ' + (this.useWeatherData ? 'enabled' : 'disabled'));
  }

  setThermalModel(K, S) {
    this.thermalModel = { K, S };
  }

  setTemperatureConstraints(minTemp, maxTemp, tempStep) {
    this.minTemp = minTemp;
    this.maxTemp = maxTemp;
    // Use the provided tempStep from settings without enforcing a minimum
    // MELCloud can accept 0.5°C increments
    this.tempStep = tempStep || 0.5;
    this.logger.log(`Temperature constraints set: min=${minTemp}°C, max=${maxTemp}°C, step=${this.tempStep}°C`);
  }

  /**
   * Set the Zone2 temperature constraints
   * @param {boolean} enableZone2 - Whether to enable Zone2 temperature control
   * @param {number} minTempZone2 - Minimum Zone2 temperature
   * @param {number} maxTempZone2 - Maximum Zone2 temperature
   * @param {number} tempStepZone2 - Maximum Zone2 temperature step
   */
  setZone2TemperatureConstraints(enableZone2, minTempZone2, maxTempZone2, tempStepZone2) {
    this.enableZone2 = enableZone2;
    this.minTempZone2 = minTempZone2;
    this.maxTempZone2 = maxTempZone2;
    this.tempStepZone2 = tempStepZone2 || 0.5;
    this.logger.log(`Zone2 temperature control: ${enableZone2 ? 'enabled' : 'disabled'}`);
    if (enableZone2) {
      this.logger.log(`Zone2 temperature constraints set: min=${minTempZone2}°C, max=${maxTempZone2}°C, step=${this.tempStepZone2}°C`);
    }
  }

  /**
   * Set the tank temperature constraints
   * @param {boolean} enableTankControl - Whether to enable tank temperature control
   * @param {number} minTankTemp - Minimum tank temperature
   * @param {number} maxTankTemp - Maximum tank temperature
   * @param {number} tankTempStep - Maximum tank temperature step
   */
  setTankTemperatureConstraints(enableTankControl, minTankTemp, maxTankTemp, tankTempStep) {
    this.enableTankControl = enableTankControl;
    this.minTankTemp = minTankTemp;
    this.maxTankTemp = maxTankTemp;
    this.tankTempStep = tankTempStep || 1.0;
    this.logger.log(`Tank temperature control: ${enableTankControl ? 'enabled' : 'disabled'}`);
    if (enableTankControl) {
      this.logger.log(`Tank temperature constraints set: min=${minTankTemp}°C, max=${maxTankTemp}°C, step=${this.tankTempStep}°C`);
    }
  }

  async runHourlyOptimization() {
    this.logger.log('Starting hourly optimization');

    try {
      // Get current device state
      const deviceState = await this.melCloud.getDeviceState(this.deviceId, this.buildingId);

      // Handle different device types
      let currentTemp;
      let currentTarget;
      let currentTankTemp;
      let currentTankTarget;
      let outdoorTemp = deviceState.OutdoorTemperature;

      if (deviceState.SetTemperatureZone1 !== undefined) {
        // This is an ATW device (like a boiler)
        currentTemp = deviceState.RoomTemperatureZone1 || 21; // Default to 21 if not available
        currentTarget = deviceState.SetTemperatureZone1;
        this.logger.log(`ATW device detected: Zone1 temp ${currentTarget}°C, Outdoor temp ${outdoorTemp || 'N/A'}°C`);

        // Check if tank water temperature is available
        if (deviceState.SetTankWaterTemperature !== undefined) {
          currentTankTemp = deviceState.TankWaterTemperature || 45; // Default to 45 if not available
          currentTankTarget = deviceState.SetTankWaterTemperature;
          this.logger.log(`Tank water temperature: Current ${currentTankTemp}°C, Target ${currentTankTarget}°C`);
        } else {
          this.logger.log('Tank water temperature not available for this device');
        }
      } else {
        // This is a regular device
        currentTemp = deviceState.RoomTemperature || 21; // Default to 21 if not available
        currentTarget = deviceState.SetTemperature;
        this.logger.log(`Regular device detected: Set temp ${currentTarget}°C, Outdoor temp ${outdoorTemp || 'N/A'}°C`);
      }

      // Get electricity prices with enhanced forecasting
      const priceData = await this.tibber.getPrices();
      const currentPrice = priceData.current.price;

      // Use the enhanced price statistics
      const priceStats = priceData.statistics;
      const priceAvg = priceStats.avg;
      const priceMin = priceStats.min;
      const priceMax = priceStats.max;

      // Get price forecast
      const priceForecast = priceData.forecast;
      // Price patterns are available in priceData.patterns if needed in the future

      this.logger.log(`Price position: ${priceForecast.currentPosition}, Recommendation: ${priceForecast.recommendation}`);

      // Log best and worst times
      if (priceForecast.bestTimes && priceForecast.bestTimes.length > 0) {
        this.logger.log(`Best times to use electricity in next 24h: ${priceForecast.bestTimes.map(t => t.timeFormatted).join(', ')}`);
      }

      if (priceForecast.worstTimes && priceForecast.worstTimes.length > 0) {
        this.logger.log(`Worst times to use electricity in next 24h: ${priceForecast.worstTimes.map(t => t.timeFormatted).join(', ')}`);
      }

      // Log upcoming price changes if significant
      if (priceForecast.upcomingChanges && priceForecast.upcomingChanges.significant) {
        this.logger.log(`Upcoming price change: ${priceForecast.upcomingChanges.message}`);
      }

      // Get weather data if available
      let weatherData = null;
      let weatherAdjustment = { adjustment: 0, reason: 'Weather data not used' };
      let weatherTrend = { trend: 'unknown', details: 'Weather data not available' };

      if (this.useWeatherData && this.weather) {
        try {
          // Get location from settings or device state or default to Oslo, Norway
          // The logger is homey.app, which has access to homey.settings
          const userLatitude = this.logger.homey?.settings?.get('latitude');
          const userLongitude = this.logger.homey?.settings?.get('longitude');

          const location = {
            latitude: userLatitude || deviceState.Latitude || 59.9, // Default to Oslo, Norway if not set
            longitude: userLongitude || deviceState.Longitude || 10.7,
            altitude: deviceState.Altitude || 0
          };

          // Log the location being used
          if (userLatitude && userLongitude) {
            this.logger.log(`Using user-defined location: ${location.latitude}, ${location.longitude}`);
          } else if (deviceState.Latitude && deviceState.Longitude) {
            this.logger.log(`Using device location: ${location.latitude}, ${location.longitude}`);
          } else {
            this.logger.log(`Using default location (Oslo, Norway): ${location.latitude}, ${location.longitude}`);
            this.logger.log('Please set your location in the app settings for more accurate weather data.');
          }

          this.logger.log(`Getting weather data for location: ${location.latitude}, ${location.longitude}`);

          // Fetch weather forecast
          weatherData = await this.weather.getForecast(
            location.latitude,
            location.longitude,
            location.altitude
          );

          // Calculate weather-based adjustment
          weatherAdjustment = this.weather.calculateWeatherBasedAdjustment(
            weatherData,
            currentTemp,
            currentTarget,
            currentPrice,
            priceAvg
          );

          // Get weather trend
          weatherTrend = this.weather.getWeatherTrend(weatherData);

          this.logger.log(`Weather adjustment: ${weatherAdjustment.adjustment.toFixed(2)}°C (${weatherAdjustment.reason})`);
          this.logger.log(`Weather trend: ${weatherTrend.trend} - ${weatherTrend.details}`);
        } catch (weatherError) {
          this.logger.error('Error getting weather data:', weatherError);
          // Continue without weather data
        }
      }

      // Calculate optimal temperature based on price and forecast
      let newTarget = this.calculateOptimalTemperature(currentPrice, priceAvg, priceMin, priceMax, currentTemp, priceForecast);

      // Apply weather adjustment if available
      if (weatherData && weatherAdjustment) {
        newTarget += weatherAdjustment.adjustment;
        this.logger.log(`Applied weather adjustment: ${weatherAdjustment.adjustment.toFixed(2)}°C, new target: ${newTarget.toFixed(1)}°C`);
      }

      // Apply constraints
      newTarget = Math.max(this.minTemp, Math.min(this.maxTemp, newTarget));

      // Apply step constraint (don't change by more than tempStep)
      const maxChange = this.tempStep;
      if (Math.abs(newTarget - currentTarget) > maxChange) {
        newTarget = currentTarget + (newTarget > currentTarget ? maxChange : -maxChange);
      }

      // Round to nearest 0.5°C (MELCloud can accept 0.5°C increments)
      newTarget = Math.round(newTarget * 2) / 2;
      this.logger.log(`Rounding temperature to nearest 0.5°C: ${newTarget}°C`);

      // Calculate savings and comfort impact
      const savings = this.calculateSavings(currentTarget, newTarget, currentPrice);
      const comfort = this.calculateComfortImpact(currentTarget, newTarget);

      // Determine reason for change, including Tibber price level
      let reason = 'No change needed';
      const priceLevel = priceData.current.level || 'NORMAL';

      if (newTarget < currentTarget) {
        reason = weatherAdjustment.adjustment < -0.2 ?
          `Tibber price level is ${priceLevel} and ${weatherAdjustment.reason.toLowerCase()}, reducing temperature` :
          `Tibber price level is ${priceLevel}, reducing temperature`;
      } else if (newTarget > currentTarget) {
        reason = weatherAdjustment.adjustment > 0.2 ?
          `Tibber price level is ${priceLevel} and ${weatherAdjustment.reason.toLowerCase()}, increasing temperature` :
          `Tibber price level is ${priceLevel}, increasing temperature`;
      }

      // Set new temperature for Zone1 if different
      if (newTarget !== currentTarget) {
        try {
          const success = await this.melCloud.setDeviceTemperature(this.deviceId, this.buildingId, newTarget, 2, 1); // Zone1

          if (success) {
            this.logger.log(`Changed Zone1 temperature from ${currentTarget}°C to ${newTarget}°C: ${reason}`);
          } else {
            this.logger.log(`WARNING: Failed to change Zone1 temperature from ${currentTarget}°C to ${newTarget}°C - API returned success but temperature was not updated`);
            this.logger.log(`Will try again in the next hourly optimization`);
            // Don't throw an error, just log the warning
          }
        } catch (error) {
          this.logger.log(`Failed to change Zone1 temperature from ${currentTarget}°C to ${newTarget}°C: ${error.message}`);
          throw new Error(`Failed to set Zone1 temperature: ${error.message}`);
        }
      } else {
        this.logger.log(`Keeping Zone1 temperature at ${currentTarget}°C: ${reason}`);
      }

      // Handle Zone2 temperature optimization if enabled
      let zone2Result = null;
      if (this.enableZone2 && deviceState.SetTemperatureZone2 !== undefined) {
        this.logger.log('Zone2 temperature optimization enabled');

        try {
          // Get current Zone2 temperature
          const currentTempZone2 = deviceState.RoomTemperatureZone2 || 21; // Default to 21 if not available
          const currentTargetZone2 = deviceState.SetTemperatureZone2;

          this.logger.log(`Current Zone2 temperature: ${currentTempZone2}°C, Target: ${currentTargetZone2}°C`);

          // Calculate optimal Zone2 temperature based on price and forecast
          // We'll use the same algorithm as Zone1 but with Zone2 constraints
          let newTargetZone2 = this.calculateOptimalTemperature(currentPrice, priceAvg, priceMin, priceMax, currentTempZone2, priceForecast);

          // Apply weather adjustment if available
          if (weatherData && weatherAdjustment) {
            newTargetZone2 += weatherAdjustment.adjustment;
            this.logger.log(`Applied weather adjustment to Zone2: ${weatherAdjustment.adjustment.toFixed(2)}°C, new target: ${newTargetZone2.toFixed(1)}°C`);
          }

          // Apply Zone2 constraints
          newTargetZone2 = Math.max(this.minTempZone2, Math.min(this.maxTempZone2, newTargetZone2));

          // Apply step constraint (don't change by more than tempStepZone2)
          const maxChangeZone2 = this.tempStepZone2;
          if (Math.abs(newTargetZone2 - currentTargetZone2) > maxChangeZone2) {
            newTargetZone2 = currentTargetZone2 + (newTargetZone2 > currentTargetZone2 ? maxChangeZone2 : -maxChangeZone2);
          }

          // Round to nearest 0.5°C (MELCloud can accept 0.5°C increments)
          newTargetZone2 = Math.round(newTargetZone2 * 2) / 2;
          this.logger.log(`Rounding Zone2 temperature to nearest 0.5°C: ${newTargetZone2}°C`);

          // Determine reason for Zone2 change
          let zone2Reason = 'No change needed';

          if (newTargetZone2 < currentTargetZone2) {
            zone2Reason = weatherAdjustment.adjustment < -0.2 ?
              `Tibber price level is ${priceLevel} and ${weatherAdjustment.reason.toLowerCase()}, reducing Zone2 temperature` :
              `Tibber price level is ${priceLevel}, reducing Zone2 temperature`;
          } else if (newTargetZone2 > currentTargetZone2) {
            zone2Reason = weatherAdjustment.adjustment > 0.2 ?
              `Tibber price level is ${priceLevel} and ${weatherAdjustment.reason.toLowerCase()}, increasing Zone2 temperature` :
              `Tibber price level is ${priceLevel}, increasing Zone2 temperature`;
          }

          // Set new Zone2 temperature if different
          if (newTargetZone2 !== currentTargetZone2) {
            try {
              const zone2Success = await this.melCloud.setDeviceTemperature(this.deviceId, this.buildingId, newTargetZone2, 2, 2); // Zone2

              if (zone2Success) {
                this.logger.log(`Changed Zone2 temperature from ${currentTargetZone2}°C to ${newTargetZone2}°C: ${zone2Reason}`);
              } else {
                this.logger.log(`WARNING: Failed to change Zone2 temperature from ${currentTargetZone2}°C to ${newTargetZone2}°C - API returned success but temperature was not updated`);
                this.logger.log(`Will try again in the next hourly optimization`);
              }
            } catch (zone2Error) {
              this.logger.log(`Failed to change Zone2 temperature from ${currentTargetZone2}°C to ${newTargetZone2}°C: ${zone2Error.message}`);
              // Don't throw an error for Zone2 temperature, just log the warning
            }
          } else {
            this.logger.log(`Keeping Zone2 temperature at ${currentTargetZone2}°C: ${zone2Reason}`);
          }

          // Store Zone2 optimization result
          zone2Result = {
            targetTemp: newTargetZone2,
            reason: zone2Reason,
            targetOriginal: currentTargetZone2,
            indoorTemp: currentTempZone2
          };
        } catch (zone2OptError) {
          this.logger.error('Error in Zone2 temperature optimization', zone2OptError);
          // Don't throw an error for Zone2 temperature, just log the error
        }
      }

      // Handle tank water temperature optimization if enabled
      let tankResult = null;
      if (this.enableTankControl && currentTankTarget !== undefined) {
        this.logger.log('Tank water temperature optimization enabled');

        try {
          // Calculate optimal tank temperature based on price
          // For tank water, we use a simpler algorithm - higher temperature when electricity is cheap
          // and lower temperature when electricity is expensive
          let newTankTarget;
          let tankReason;

          // Use Tibber price level for tank temperature optimization
          const priceLevel = priceData.current.level || 'NORMAL';

          if (priceLevel === 'VERY_CHEAP' || priceLevel === 'CHEAP') {
            // When electricity is cheap, heat the tank to maximum temperature
            newTankTarget = this.maxTankTemp;
            tankReason = `Tibber price level is ${priceLevel}, increasing tank temperature to maximum`;
          } else if (priceLevel === 'EXPENSIVE' || priceLevel === 'VERY_EXPENSIVE') {
            // When electricity is expensive, reduce tank temperature to minimum
            newTankTarget = this.minTankTemp;
            tankReason = `Tibber price level is ${priceLevel}, reducing tank temperature to minimum`;
          } else {
            // For normal prices, use a middle temperature
            newTankTarget = (this.minTankTemp + this.maxTankTemp) / 2;
            tankReason = `Tibber price level is ${priceLevel}, setting tank temperature to middle value`;
          }

          // Apply step constraint (don't change by more than tankTempStep)
          const maxTankChange = this.tankTempStep;
          if (Math.abs(newTankTarget - currentTankTarget) > maxTankChange) {
            newTankTarget = currentTankTarget + (newTankTarget > currentTankTarget ? maxTankChange : -maxTankChange);
          }

          // Round to nearest 0.5°C (MELCloud can accept 0.5°C increments)
          newTankTarget = Math.round(newTankTarget * 2) / 2;
          this.logger.log(`Rounding tank temperature to nearest 0.5°C: ${newTankTarget}°C`);

          // Set new tank temperature if different
          if (newTankTarget !== currentTankTarget) {
            try {
              const tankSuccess = await this.melCloud.setDeviceTankTemperature(this.deviceId, this.buildingId, newTankTarget);

              if (tankSuccess) {
                this.logger.log(`Changed tank temperature from ${currentTankTarget}°C to ${newTankTarget}°C: ${tankReason}`);
              } else {
                this.logger.log(`WARNING: Failed to change tank temperature from ${currentTankTarget}°C to ${newTankTarget}°C - API returned success but temperature was not updated`);
                this.logger.log(`Will try again in the next hourly optimization`);
              }
            } catch (tankError) {
              this.logger.log(`Failed to change tank temperature from ${currentTankTarget}°C to ${newTankTarget}°C: ${tankError.message}`);
              // Don't throw an error for tank temperature, just log the warning
            }
          } else {
            this.logger.log(`Keeping tank temperature at ${currentTankTarget}°C: ${tankReason}`);
          }

          // Store tank optimization result
          tankResult = {
            targetTemp: newTankTarget,
            reason: tankReason,
            targetOriginal: currentTankTarget
          };
        } catch (tankOptError) {
          this.logger.error('Error in tank temperature optimization', tankOptError);
          // Don't throw an error for tank temperature, just log the error
        }
      }

      // Get comfort profile information using our time zone-aware function
      const localTime = this.getLocalTime();
      const currentHour = localTime.hour;
      const localTimeString = localTime.timeString;
      const comfortFactor = this.calculateComfortFactor(currentHour);
      const dayStart = this.logger.homey?.settings?.get('day_start_hour') || 6;
      const dayEnd = this.logger.homey?.settings?.get('day_end_hour') || 22;
      const nightTempReduction = this.logger.homey?.settings?.get('night_temp_reduction') || 2;
      const preHeatHours = this.logger.homey?.settings?.get('pre_heat_hours') || 1;
      const timeZoneOffset = this.logger.homey?.settings?.get('time_zone_offset') || 2;
      const useDst = this.logger.homey?.settings?.get('use_dst') !== false;

      this.logger.log(`Comfort profile calculation using local time: ${localTimeString} (Hour: ${currentHour})`);

      // Create result object
      const result = {
        targetTemp: newTarget,
        reason,
        priceNow: currentPrice,
        priceAvg,
        priceMin,
        priceMax,
        indoorTemp: currentTemp,
        outdoorTemp: deviceState.OutdoorTemperature,
        targetOriginal: currentTarget,
        savings,
        comfort,
        timestamp: new Date().toISOString(),
        kFactor: this.thermalModel.K,
        // Include Zone2 temperature optimization result if available
        zone2Temperature: zone2Result ? {
          targetTemp: zone2Result.targetTemp,
          reason: zone2Result.reason,
          targetOriginal: zone2Result.targetOriginal,
          indoorTemp: zone2Result.indoorTemp
        } : null,
        // Include tank temperature optimization result if available
        tankTemperature: tankResult ? {
          targetTemp: tankResult.targetTemp,
          reason: tankResult.reason,
          targetOriginal: tankResult.targetOriginal
        } : null,
        // Include comfort profile information
        comfortProfile: {
          factor: comfortFactor,
          currentHour,
          localTime: localTimeString,
          dayStart,
          dayEnd,
          nightTempReduction,
          preHeatHours,
          timeZone: {
            offset: timeZoneOffset,
            useDst: useDst
          },
          mode: comfortFactor >= 0.9 ? 'day' : comfortFactor <= 0.6 ? 'night' : 'transition'
        },
        // Include price forecast data
        priceForecast: priceForecast ? {
          position: priceForecast.currentPosition,
          recommendation: priceForecast.recommendation,
          upcomingChanges: priceForecast.upcomingChanges,
          bestTimes: priceForecast.bestTimes,
          worstTimes: priceForecast.worstTimes
        } : null,
        // Include weather data if available
        weather: weatherData ? {
          current: {
            temperature: weatherData.current.temperature,
            humidity: weatherData.current.humidity,
            windSpeed: weatherData.current.windSpeed,
            cloudCover: weatherData.current.cloudCover,
            symbol: weatherData.current.symbol
          },
          adjustment: weatherAdjustment.adjustment,
          reason: weatherAdjustment.reason,
          trend: weatherTrend.trend,
          trendDetails: weatherTrend.details
        } : null
      };

      // Store the result in historical data for weekly calibration
      historicalData.optimizations.push(result);

      // Keep only the last 168 optimizations (1 week of hourly data)
      if (historicalData.optimizations.length > 168) {
        historicalData.optimizations.shift();
      }

      return result;
    } catch (error) {
      this.logger.error('Error in hourly optimization', error);
      throw error;
    }
  }

  async runWeeklyCalibration() {
    this.logger.log('Starting weekly calibration');

    try {
      // Check if we have enough historical data
      if (historicalData.optimizations.length < 24) {
        this.logger.log('Not enough historical data for calibration. Need at least 24 data points.');
        return {
          success: false,
          message: 'Not enough historical data for calibration. Need at least 24 data points.',
          oldK: this.thermalModel.K,
          newK: this.thermalModel.K,
          timestamp: new Date().toISOString(),
        };
      }

      let newK;
      let analysis = '';

      // Use OpenAI if available, otherwise use simple algorithm
      if (this.openai) {
        this.logger.log('Using OpenAI for thermal model calibration');

        // Prepare data for OpenAI
        const dataForAnalysis = {
          currentKFactor: this.thermalModel.K,
          historicalData: historicalData.optimizations,
          temperatureConstraints: {
            minTemp: this.minTemp,
            maxTemp: this.maxTemp,
            tempStep: this.tempStep
          },
          // Include weather data analysis if available
          weatherAnalysis: this.analyzeWeatherImpact(historicalData.optimizations),
          // Include price forecast analysis
          priceAnalysis: this.analyzePriceForecastImpact(historicalData.optimizations)
        };

        // Get analysis from OpenAI
        const openaiResult = await this.openai.analyzeData(dataForAnalysis);
        newK = openaiResult.kFactor;
        analysis = openaiResult.analysis;

        this.logger.log('OpenAI analysis received');
        this.logger.log(`Recommended K factor: ${newK}`);
      } else {
        this.logger.log('Using simple algorithm for thermal model calibration');

        // Simple algorithm: analyze temperature changes vs price changes
        // Calculate average temperature change per price change
        let totalTempChange = 0;
        let totalPriceChange = 0;
        let count = 0;

        for (let i = 1; i < historicalData.optimizations.length; i++) {
          const prev = historicalData.optimizations[i-1];
          const curr = historicalData.optimizations[i];

          const tempChange = Math.abs(curr.targetTemp - prev.targetTemp);
          const priceChange = Math.abs(curr.priceNow - prev.priceNow);

          if (priceChange > 0) {
            totalTempChange += tempChange;
            totalPriceChange += priceChange;
            count++;
          }
        }

        // Calculate average response factor
        const avgResponse = count > 0 ? totalTempChange / totalPriceChange : 0;

        // Adjust K factor based on response
        const currentK = this.thermalModel.K;
        const targetResponse = 0.5; // Ideal response factor

        if (avgResponse > 0) {
          // Adjust K to move closer to target response
          const adjustment = (targetResponse / avgResponse - 1) * 0.2; // 20% adjustment towards target
          newK = Math.max(0.1, Math.min(1.0, currentK * (1 + adjustment)));
        } else {
          // No meaningful data, make small random adjustment
          newK = currentK * (0.9 + Math.random() * 0.2);
        }

        analysis = `Simple calibration algorithm used. Average temperature change per price change: ${avgResponse.toFixed(4)}. Adjusted K factor from ${currentK.toFixed(2)} to ${newK.toFixed(2)}.`;
        this.logger.log(analysis);
      }

      // Update thermal model
      this.setThermalModel(newK);

      this.logger.log(`Calibrated thermal model: K=${newK.toFixed(2)}`);

      // Store calibration result
      historicalData.lastCalibration = {
        timestamp: new Date().toISOString(),
        oldK: this.thermalModel.K,
        newK: newK,
        analysis: analysis
      };

      // Return result
      return {
        success: true,
        message: 'Weekly calibration completed successfully',
        oldK: this.thermalModel.K,
        newK: newK,
        analysis: analysis,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error in weekly calibration', error);
      throw error;
    }
  }

  /**
   * Get the current local time based on user's time zone settings
   * @returns {Object} - Object with date, hour, and formatted time string
   */
  getLocalTime() {
    // IMPORTANT: Use the local system time directly instead of UTC conversion
    // This ensures we use the correct time regardless of system time zone settings
    const now = new Date();

    // Get the local hour directly from the system
    const localHour = now.getHours();
    const localTimeString = now.toString();

    // Get time zone settings for logging purposes only
    const timeZoneOffset = this.logger.homey?.settings?.get('time_zone_offset') || 1; // Default to UTC+1
    const useDst = this.logger.homey?.settings?.get('use_dst') !== false; // Default to true

    this.logger.log(`Time zone: UTC${timeZoneOffset >= 0 ? '+' : ''}${timeZoneOffset}${useDst ? ' with DST' : ''}`);
    this.logger.log(`System time: ${now.toISOString()}, Local time: ${localTimeString}`);

    return {
      date: now,
      hour: localHour,
      timeString: localTimeString
    };
  }

  /**
   * Calculate comfort factor based on time of day
   * @param {number} hour - Current hour (0-23)
   * @returns {number} - Comfort factor (0.5-1.0)
   */
  calculateComfortFactor(hour) {
    // Get comfort profiles from settings
    const dayStart = this.logger.homey?.settings?.get('day_start_hour') || 6;  // Default: 6 AM
    const dayEnd = this.logger.homey?.settings?.get('day_end_hour') || 22;     // Default: 10 PM
    const preHeatHours = this.logger.homey?.settings?.get('pre_heat_hours') || 1; // Default: 1 hour

    // Calculate transition periods
    const morningTransitionStart = (dayStart - preHeatHours + 24) % 24;
    const eveningTransitionStart = dayEnd - 1;

    // Get the current local time using our time zone-aware function
    const localTime = this.getLocalTime();

    // Use the provided hour parameter if available, otherwise use local hour
    const currentHour = (hour !== undefined) ? hour : localTime.hour;

    // Log the comfort profile settings
    this.logger.log(`Comfort profile: Day ${dayStart}:00-${dayEnd}:00, Pre-heat: ${preHeatHours}h, Current hour: ${currentHour}:00 (Local time: ${localTime.timeString})`);

    if (currentHour >= dayStart && currentHour < eveningTransitionStart) {
      // Full day comfort
      return 1.0;
    } else if (currentHour >= eveningTransitionStart && currentHour < dayEnd) {
      // Evening transition (gradually reducing comfort)
      const transitionProgress = (currentHour - eveningTransitionStart) / (dayEnd - eveningTransitionStart);
      return 1.0 - (transitionProgress * 0.5); // Reduce to 0.5 at end of day
    } else if ((currentHour >= dayEnd) || (currentHour < morningTransitionStart)) {
      // Night (lower comfort priority)
      return 0.5;
    } else {
      // Morning transition (gradually increasing comfort)
      const transitionProgress = (currentHour - morningTransitionStart) / preHeatHours;
      return 0.5 + (transitionProgress * 0.5); // Increase from 0.5 to 1.0
    }
  }

  /**
   * Calculate the optimal temperature based on price data and forecasts
   * @param {number} currentPrice - Current electricity price
   * @param {number} avgPrice - Average electricity price
   * @param {number} minPrice - Minimum electricity price
   * @param {number} maxPrice - Maximum electricity price
   * @param {number} currentTemp - Current room temperature
   * @param {Object} [priceForecast] - Price forecast data (optional)
   * @returns {number} - Optimal temperature setting
   */
  calculateOptimalTemperature(currentPrice, avgPrice, minPrice, maxPrice, currentTemp, priceForecast = null) {
    // Get current hour in local time zone using our time zone-aware function
    const localTime = this.getLocalTime();
    const currentHour = localTime.hour;

    this.logger.log(`Current local time: ${localTime.timeString} (Hour: ${currentHour})`);

    // Calculate comfort factor (0.5-1.0)
    const comfortFactor = this.calculateComfortFactor(currentHour);

    // Get night temperature reduction setting
    const nightTempReduction = this.logger.homey?.settings?.get('night_temp_reduction') || 2; // Default: 2°C

    // Adjust temperature range based on comfort factor
    const comfortAdjustedMinTemp = this.minTemp + ((1 - comfortFactor) * nightTempReduction);
    const comfortAdjustedMaxTemp = this.maxTemp - ((1 - comfortFactor) * nightTempReduction);

    // Log the comfort adjustments
    this.logger.log(`Comfort factor: ${comfortFactor.toFixed(2)} (Hour: ${currentHour}:00)`);
    this.logger.log(`Comfort-adjusted temperature range: ${comfortAdjustedMinTemp.toFixed(1)}°C - ${comfortAdjustedMaxTemp.toFixed(1)}°C`);

    // Normalize price between 0 and 1
    const priceRange = maxPrice - minPrice;
    const normalizedPrice = priceRange > 0
      ? (currentPrice - minPrice) / priceRange
      : 0.5;

    // Invert (lower price = higher temperature)
    const invertedPrice = 1 - normalizedPrice;

    // Calculate temperature offset based on price with comfort adjustment
    const tempRange = comfortAdjustedMaxTemp - comfortAdjustedMinTemp;
    const midTemp = (comfortAdjustedMaxTemp + comfortAdjustedMinTemp) / 2;

    // Base target temperature calculation
    let targetTemp = midTemp + (invertedPrice - 0.5) * tempRange;

    // Apply forecast-based adjustments if available
    if (priceForecast) {
      // If price is going to increase significantly soon, pre-heat a bit more
      if (priceForecast.upcomingChanges && priceForecast.upcomingChanges.significant) {
        const change = priceForecast.upcomingChanges.change;
        const changeTime = new Date(priceForecast.upcomingChanges.time);
        const now = new Date();
        const hoursUntilChange = (changeTime - now) / (1000 * 60 * 60);

        // Only apply pre-heating if price will increase within next 3 hours
        if (change > 0 && hoursUntilChange <= 3) {
          // Calculate adjustment based on how soon and how much the price will increase
          const priceChangePercent = priceForecast.upcomingChanges.changePercent;
          const adjustment = Math.min(1, (priceChangePercent / 100) * (3 - hoursUntilChange) / 3);

          targetTemp += adjustment;
          this.logger.log(`Applied pre-heating adjustment of +${adjustment.toFixed(2)}°C due to upcoming price increase of ${priceChangePercent.toFixed(1)}% in ${hoursUntilChange.toFixed(1)} hours`);
        }
        // If price will decrease soon, reduce temperature a bit
        else if (change < 0 && hoursUntilChange <= 2) {
          const priceChangePercent = Math.abs(priceForecast.upcomingChanges.changePercent);
          const adjustment = Math.min(1, (priceChangePercent / 100) * (2 - hoursUntilChange) / 2);

          targetTemp -= adjustment;
          this.logger.log(`Applied pre-cooling adjustment of -${adjustment.toFixed(2)}°C due to upcoming price decrease of ${priceChangePercent.toFixed(1)}% in ${hoursUntilChange.toFixed(1)} hours`);
        }
      }

      // Consider price position in forecast based on Tibber's price level
      if (priceForecast.currentPosition === 'low') {
        // If Tibber says price is CHEAP or VERY_CHEAP, heat more
        targetTemp += 1.0;
        this.logger.log('Applied +1.0°C adjustment due to CHEAP or VERY_CHEAP price level from Tibber');
      } else if (priceForecast.currentPosition === 'high') {
        // If Tibber says price is EXPENSIVE or VERY_EXPENSIVE, reduce temperature more
        targetTemp -= 2.0;
        this.logger.log('Applied -2.0°C adjustment due to EXPENSIVE or VERY_EXPENSIVE price level from Tibber');
      } else {
        // If price is NORMAL, make a smaller adjustment
        targetTemp -= 0.5;
        this.logger.log('Applied -0.5°C adjustment due to NORMAL price level from Tibber');
      }

      // Check if we're approaching wake-up time
      const dayStart = this.logger.homey?.settings?.get('day_start_hour') || 6;
      const preHeatHours = this.logger.homey?.settings?.get('pre_heat_hours') || 1;
      const hoursUntilWakeUp = (dayStart - currentHour + 24) % 24;

      this.logger.log(`Wake-up time: ${dayStart}:00, Hours until wake-up: ${hoursUntilWakeUp}`);

      // If we're within the pre-heat window before wake-up
      if (hoursUntilWakeUp > 0 && hoursUntilWakeUp <= preHeatHours) {
        // Check if prices are favorable for pre-heating
        const currentPricePosition = priceForecast.currentPosition || 'medium';
        const upcomingPrices = priceForecast.worstTimes || [];

        // Check if morning hours have high prices
        const morningHasPriceSpike = upcomingPrices.some(time => {
          const timeHour = new Date(time.time).getHours();
          return Math.abs(timeHour - dayStart) <= 2; // Within 2 hours of wake-up
        });

        if (currentPricePosition === 'low' && morningHasPriceSpike) {
          // Current price is low and morning has price spikes, pre-heat more aggressively
          const preHeatingAdjustment = 1.0 * (preHeatHours - hoursUntilWakeUp) / preHeatHours;
          targetTemp += preHeatingAdjustment;
          this.logger.log(`Applied wake-up pre-heating of +${preHeatingAdjustment.toFixed(2)}°C (${hoursUntilWakeUp.toFixed(1)} hours until wake-up at ${dayStart}:00)`);
        } else {
          // Standard pre-heating as we approach wake-up time
          const preHeatingAdjustment = 0.5 * (preHeatHours - hoursUntilWakeUp) / preHeatHours;
          targetTemp += preHeatingAdjustment;
          this.logger.log(`Applied standard wake-up pre-heating of +${preHeatingAdjustment.toFixed(2)}°C (${hoursUntilWakeUp.toFixed(1)} hours until wake-up at ${dayStart}:00)`);
        }
      }
    }

    this.logger.log(`Price analysis: current=${currentPrice.toFixed(2)}, avg=${avgPrice.toFixed(2)}, min=${minPrice.toFixed(2)}, max=${maxPrice.toFixed(2)}`);
    this.logger.log(`Temperature calculation: normalized=${normalizedPrice.toFixed(2)}, inverted=${invertedPrice.toFixed(2)}, target=${targetTemp.toFixed(1)}°C`);
    this.logger.log(`Current room temperature: ${currentTemp}°C`);

    return targetTemp;
  }

  calculateSavings(oldTemp, newTemp, currentPrice) {
    // Simple model: each degree lower saves about 5% energy
    const tempDiff = oldTemp - newTemp;
    const energySavingPercent = tempDiff * 5;

    // Convert to monetary value (very rough estimate)
    // Assuming average consumption of 1 kWh per hour
    const hourlyConsumption = 1; // kWh
    const savings = (energySavingPercent / 100) * hourlyConsumption * currentPrice;

    return savings;
  }

  calculateComfortImpact(oldTemp, newTemp) {
    // Simple model: deviation from 21°C reduces comfort
    const idealTemp = 21;
    const oldDeviation = Math.abs(oldTemp - idealTemp);
    const newDeviation = Math.abs(newTemp - idealTemp);

    // Positive means improved comfort, negative means reduced comfort
    return oldDeviation - newDeviation;
  }

  /**
   * Analyze the impact of weather on optimization results
   * @param {Array} optimizations - Historical optimization data
   * @returns {Object} - Weather impact analysis
   */
  analyzeWeatherImpact(optimizations) {
    if (!optimizations || optimizations.length === 0) {
      return { available: false, reason: 'No historical data available' };
    }

    // Count optimizations with weather data
    const withWeatherData = optimizations.filter(opt => opt.weather !== null && opt.weather !== undefined);

    if (withWeatherData.length === 0) {
      return { available: false, reason: 'No weather data in historical optimizations' };
    }

    // Analyze correlations between weather and temperature adjustments
    const correlations = {
      outdoorTemp: [],
      windSpeed: [],
      cloudCover: []
    };

    // Calculate correlations
    withWeatherData.forEach(opt => {
      const tempChange = opt.targetTemp - opt.targetOriginal;

      if (opt.outdoorTemp !== undefined) {
        correlations.outdoorTemp.push({
          outdoorTemp: opt.outdoorTemp,
          tempChange: tempChange
        });
      }

      if (opt.weather && opt.weather.current) {
        if (opt.weather.current.windSpeed !== undefined) {
          correlations.windSpeed.push({
            windSpeed: opt.weather.current.windSpeed,
            tempChange: tempChange
          });
        }

        if (opt.weather.current.cloudCover !== undefined) {
          correlations.cloudCover.push({
            cloudCover: opt.weather.current.cloudCover,
            tempChange: tempChange
          });
        }
      }
    });

    // Calculate average impact
    const calculateAvgImpact = (data, key) => {
      if (data.length === 0) return { correlation: 0, confidence: 0 };

      // Group by ranges
      const groups = {};
      data.forEach(item => {
        const value = item[key];
        const range = Math.floor(value / 5) * 5; // Group in 5-unit ranges
        if (!groups[range]) groups[range] = [];
        groups[range].push(item.tempChange);
      });

      // Calculate average change per range
      const rangeImpacts = Object.entries(groups).map(([range, changes]) => {
        const avgChange = changes.reduce((sum, change) => sum + change, 0) / changes.length;
        return { range: parseInt(range), avgChange, count: changes.length };
      });

      // Calculate correlation (simplified)
      let correlation = 0;
      if (rangeImpacts.length > 1) {
        // Sort by range
        rangeImpacts.sort((a, b) => a.range - b.range);

        // Calculate if higher values tend to correlate with higher or lower temperature changes
        let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0;
        const n = rangeImpacts.length;

        rangeImpacts.forEach(impact => {
          const x = impact.range;
          const y = impact.avgChange;
          sumXY += x * y;
          sumX += x;
          sumY += y;
          sumX2 += x * x;
          sumY2 += y * y;
        });

        const numerator = n * sumXY - sumX * sumY;
        const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

        if (denominator !== 0) {
          correlation = numerator / denominator;
        }
      }

      // Calculate confidence based on data points and consistency
      const totalPoints = data.length;
      const confidence = Math.min(1, totalPoints / 50); // Max confidence at 50+ data points

      return {
        correlation: correlation,
        confidence: confidence,
        dataPoints: totalPoints,
        rangeImpacts: rangeImpacts
      };
    };

    // Generate analysis
    const analysis = {
      available: true,
      dataPoints: withWeatherData.length,
      outdoorTemperature: calculateAvgImpact(correlations.outdoorTemp, 'outdoorTemp'),
      windSpeed: calculateAvgImpact(correlations.windSpeed, 'windSpeed'),
      cloudCover: calculateAvgImpact(correlations.cloudCover, 'cloudCover'),
      summary: ''
    };

    // Generate summary
    let summary = `Analysis based on ${withWeatherData.length} data points with weather information. `;

    if (analysis.outdoorTemperature.correlation !== 0) {
      const direction = analysis.outdoorTemperature.correlation > 0 ? 'higher' : 'lower';
      summary += `Outdoor temperature shows a ${Math.abs(analysis.outdoorTemperature.correlation).toFixed(2)} correlation with ${direction} indoor temperature settings. `;
    }

    if (analysis.windSpeed.correlation !== 0) {
      const direction = analysis.windSpeed.correlation > 0 ? 'higher' : 'lower';
      summary += `Wind speed shows a ${Math.abs(analysis.windSpeed.correlation).toFixed(2)} correlation with ${direction} indoor temperature settings. `;
    }

    if (analysis.cloudCover.correlation !== 0) {
      const direction = analysis.cloudCover.correlation > 0 ? 'higher' : 'lower';
      summary += `Cloud cover shows a ${Math.abs(analysis.cloudCover.correlation).toFixed(2)} correlation with ${direction} indoor temperature settings. `;
    }

    analysis.summary = summary;
    return analysis;
  }

  /**
   * Analyze the impact of price forecasts on optimization results
   * @param {Array} optimizations - Historical optimization data
   * @returns {Object} - Price forecast impact analysis
   */
  analyzePriceForecastImpact(optimizations) {
    if (!optimizations || optimizations.length === 0) {
      return { available: false, reason: 'No historical data available' };
    }

    // Count optimizations with price forecast data
    const withPriceForecast = optimizations.filter(opt => opt.priceForecast !== null && opt.priceForecast !== undefined);

    if (withPriceForecast.length === 0) {
      return { available: false, reason: 'No price forecast data in historical optimizations' };
    }

    // Analyze effectiveness of price position predictions
    const positionEffectiveness = {
      low: { correct: 0, total: 0 },
      medium: { correct: 0, total: 0 },
      high: { correct: 0, total: 0 }
    };

    // Track pre-heating/cooling effectiveness in future versions

    // Analyze price change predictions
    const priceChangePredictions = [];

    // Calculate effectiveness metrics
    withPriceForecast.forEach(opt => {
      const forecast = opt.priceForecast;
      const position = forecast.position;
      const tempChange = opt.targetTemp - opt.targetOriginal;

      // Analyze position effectiveness
      if (position) {
        positionEffectiveness[position].total++;

        // Check if the temperature change matched the expected direction based on price position
        const expectedDirection = position === 'low' ? 1 : position === 'high' ? -1 : 0;
        const actualDirection = Math.sign(tempChange);

        if (expectedDirection === actualDirection) {
          positionEffectiveness[position].correct++;
        }
      }

      // Analyze pre-heating/cooling effectiveness
      if (forecast.upcomingChanges && forecast.upcomingChanges.significant) {
        const change = forecast.upcomingChanges;

        priceChangePredictions.push({
          predictedChange: change.change,
          predictedTime: change.time,
          tempAdjustment: tempChange,
          timestamp: opt.timestamp
        });
      }
    });

    // Calculate position accuracy
    const positionAccuracy = {};
    Object.keys(positionEffectiveness).forEach(pos => {
      const data = positionEffectiveness[pos];
      positionAccuracy[pos] = data.total > 0 ? (data.correct / data.total) * 100 : 0;
    });

    // Analyze best/worst time recommendations
    const timeRecommendations = {
      bestTimesUsed: 0,
      worstTimesAvoided: 0,
      total: withPriceForecast.length
    };

    // Generate analysis
    const analysis = {
      available: true,
      dataPoints: withPriceForecast.length,
      positionAccuracy,
      priceChangePredictions: priceChangePredictions.length,
      timeRecommendations,
      summary: ''
    };

    // Generate summary
    let summary = `Analysis based on ${withPriceForecast.length} data points with price forecast information. `;

    // Add position accuracy to summary
    summary += `Price position prediction accuracy: Low=${positionAccuracy.low.toFixed(1)}%, Medium=${positionAccuracy.medium.toFixed(1)}%, High=${positionAccuracy.high.toFixed(1)}%. `;

    // Add price change predictions to summary
    if (priceChangePredictions.length > 0) {
      summary += `Made ${priceChangePredictions.length} significant price change predictions. `;
    }

    analysis.summary = summary;
    return analysis;
  }
}

// Create instances of services
let melCloud = null;
let tibber = null;
let openai = null;
let weather = null;
let optimizer = null;

// Store historical data for weekly calibration
let historicalData = {
  optimizations: [],
  lastCalibration: null
};

// Initialize services
async function initializeServices(homey) {
  if (melCloud && tibber && optimizer) {
    return; // Already initialized
  }

  try {
    // Get credentials from settings (with fallbacks for different setting names)
    const melcloudUser = homey.settings.get('melcloud_user') || homey.settings.get('melcloudUser');
    const melcloudPass = homey.settings.get('melcloud_pass') || homey.settings.get('melcloudPass');
    const tibberToken = homey.settings.get('tibber_token') || homey.settings.get('tibberToken');
    const openaiApiKey = homey.settings.get('openai_api_key') || homey.settings.get('openaiApiKey');
    const deviceId = homey.settings.get('device_id') || homey.settings.get('deviceId') || 'Boiler';
    const buildingId = parseInt(homey.settings.get('building_id') || homey.settings.get('buildingId') || '456');
    const useWeatherData = homey.settings.get('use_weather_data') !== false; // Default to true

    // Validate required settings
    if (!melcloudUser || !melcloudPass) {
      throw new Error('MELCloud credentials are required. Please configure them in the settings.');
    }

    if (!tibberToken) {
      throw new Error('Tibber API token is required. Please configure it in the settings.');
    }

    // Device ID and Building ID are now optional with defaults
    homey.app.log(`Using device ID: ${deviceId}`);
    homey.app.log(`Using building ID: ${buildingId}`);

    // If buildingId is NaN, set a default
    if (isNaN(buildingId)) {
      buildingId = 456;
      homey.app.log(`Building ID was invalid, using default: ${buildingId}`);
    }

    // Log settings (without passwords)
    homey.app.log('Initializing services with settings:');
    homey.app.log('- MELCloud User:', melcloudUser ? '✓ Set' : '✗ Not set');
    homey.app.log('- MELCloud Pass:', melcloudPass ? '✓ Set' : '✗ Not set');
    homey.app.log('- Tibber Token:', tibberToken ? '✓ Set' : '✗ Not set');
    homey.app.log('- OpenAI API Key:', openaiApiKey ? '✓ Set' : '✗ Not set');
    homey.app.log('- Device ID:', deviceId, '(Will be resolved after login)');
    homey.app.log('- Building ID:', buildingId, '(Will be resolved after login)');
    homey.app.log('- Weather Data:', useWeatherData ? '✓ Enabled' : '✗ Disabled');

    // Create MELCloud API instance
    melCloud = new MelCloudApi();
    await melCloud.login(melcloudUser, melcloudPass);
    homey.app.log('Successfully logged in to MELCloud');

    // Get devices
    const devices = await melCloud.getDevices();
    homey.app.log(`Found ${devices.length} devices in MELCloud account`);

    // Display available devices and buildings for easy reference
    if (devices.length > 0) {
      homey.app.log('===== AVAILABLE DEVICES =====');
      devices.forEach(device => {
        homey.app.log(`Device: ${device.name} (ID: ${device.id}, Building ID: ${device.buildingId})`);
      });
      homey.app.log('=============================');

      // Check if the configured device ID exists
      const configuredDeviceExists = devices.some(device =>
        device.id.toString() === deviceId.toString() ||
        device.name.toLowerCase() === deviceId.toLowerCase()
      );

      if (!configuredDeviceExists) {
        homey.app.log(`WARNING: Configured device ID "${deviceId}" not found in your MELCloud account.`);
        homey.app.log(`Will use the first available device instead: ${devices[0].name} (ID: ${devices[0].id}).`);
      }
    } else {
      homey.app.log('WARNING: No devices found in your MELCloud account. Please check your MELCloud credentials.');
    }

    // Create Tibber API instance
    tibber = new TibberApi(tibberToken);

    // Create OpenAI API instance if API key is provided
    if (openaiApiKey) {
      openai = new OpenAiApi(openaiApiKey);
      homey.app.log('OpenAI API initialized');
    } else {
      homey.app.log('OpenAI API key not provided, weekly calibration will use simple algorithm');
    }

    // Create Weather API instance if enabled
    if (useWeatherData) {
      try {
        // Import the WeatherApi class
        const WeatherApi = require('./weather');

        // Create the Weather API instance with a custom user agent
        weather = new WeatherApi(
          'MELCloudOptimizer/1.0 github.com/decline27/melcloud-optimizer',
          homey.app
        );
        homey.app.log('Weather API initialized');
      } catch (weatherError) {
        homey.app.error('Failed to initialize Weather API:', weatherError);
        homey.app.log('Continuing without weather data');
        weather = null;
      }
    } else {
      homey.app.log('Weather data disabled in settings');
      weather = null;
    }

    // Create Optimizer instance
    optimizer = new Optimizer(melCloud, tibber, deviceId, buildingId, homey.app, openai, weather);

    // Configure optimizer with initial settings
    await updateOptimizerSettings(homey);

    homey.app.log('Services initialized successfully');
  } catch (err) {
    homey.app.error('Failed to initialize services:', err);
    throw err;
  }
}

// Function to update optimizer settings from Homey settings
async function updateOptimizerSettings(homey) {
  if (!optimizer) {
    return; // Optimizer not initialized yet
  }

  // Get the latest heating temperature settings
  const minTemp = homey.settings.get('min_temp') || 18;
  const maxTemp = homey.settings.get('max_temp') || 22;
  const tempStep = homey.settings.get('temp_step_max') || 0.5;
  const kFactor = homey.settings.get('initial_k') || 0.5;

  // Get the latest Zone2 settings
  const enableZone2 = homey.settings.get('enable_zone2') === true;
  const minTempZone2 = homey.settings.get('min_temp_zone2') || 18;
  const maxTempZone2 = homey.settings.get('max_temp_zone2') || 22;
  const tempStepZone2 = homey.settings.get('temp_step_zone2') || 0.5;

  // Get the latest hot water tank settings
  const enableTankControl = homey.settings.get('enable_tank_control') === true;
  const minTankTemp = homey.settings.get('min_tank_temp') || 40;
  const maxTankTemp = homey.settings.get('max_tank_temp') || 50;
  const tankTempStep = homey.settings.get('tank_temp_step') || 1.0;

  // Log the current settings
  homey.app.log('Optimizer settings:');
  homey.app.log('- Min Temp:', minTemp, '°C');
  homey.app.log('- Max Temp:', maxTemp, '°C');
  homey.app.log('- Temp Step:', tempStep, '°C (MELCloud supports 0.5°C increments)');
  homey.app.log('- K Factor:', kFactor);

  // Log Zone2 settings
  homey.app.log('Zone2 settings:');
  homey.app.log('- Zone2 Control:', enableZone2 ? 'Enabled' : 'Disabled');
  if (enableZone2) {
    homey.app.log('- Min Temp Zone2:', minTempZone2, '°C');
    homey.app.log('- Max Temp Zone2:', maxTempZone2, '°C');
    homey.app.log('- Temp Step Zone2:', tempStepZone2, '°C');
  }

  // Log tank settings
  homey.app.log('Hot Water Tank settings:');
  homey.app.log('- Tank Control:', enableTankControl ? 'Enabled' : 'Disabled');
  if (enableTankControl) {
    homey.app.log('- Min Tank Temp:', minTankTemp, '°C');
    homey.app.log('- Max Tank Temp:', maxTankTemp, '°C');
    homey.app.log('- Tank Temp Step:', tankTempStep, '°C');
  }

  // Update the optimizer with the latest settings
  optimizer.setTemperatureConstraints(minTemp, maxTemp, tempStep);
  optimizer.setZone2TemperatureConstraints(enableZone2, minTempZone2, maxTempZone2, tempStepZone2);
  optimizer.setTankTemperatureConstraints(enableTankControl, minTankTemp, maxTankTemp, tankTempStep);
  optimizer.setThermalModel(kFactor);
}

module.exports = {
  async getDeviceList({ homey }) {
    try {
      console.log('API method getDeviceList called');
      homey.app.log('API method getDeviceList called');

      // Initialize services if needed
      try {
        await initializeServices(homey);
      } catch (initErr) {
        return {
          success: false,
          error: `Failed to initialize services: ${initErr.message}`,
          needsConfiguration: true
        };
      }

      // Get the list of devices
      try {
        // Refresh the device list to ensure we have the latest data
        const devices = await melCloud.getDevices();
        homey.app.log(`Found ${devices.length} devices in MELCloud account`);

        // Format the devices for the dropdown
        const formattedDevices = devices.map(device => ({
          id: device.id,
          name: device.name,
          buildingId: device.buildingId,
          type: device.type,
          // Include information about zones if available
          hasZone1: device.data && device.data.SetTemperatureZone1 !== undefined,
          hasZone2: device.data && device.data.SetTemperatureZone2 !== undefined,
          // Include current temperatures if available
          currentTemperatureZone1: device.data && device.data.RoomTemperatureZone1,
          currentTemperatureZone2: device.data && device.data.RoomTemperatureZone2,
          currentSetTemperatureZone1: device.data && device.data.SetTemperatureZone1,
          currentSetTemperatureZone2: device.data && device.data.SetTemperatureZone2
        }));

        // Group devices by building
        const buildings = {};
        devices.forEach(device => {
          if (!buildings[device.buildingId]) {
            buildings[device.buildingId] = {
              id: device.buildingId,
              name: `Building ${device.buildingId}`,
              devices: []
            };
          }
          buildings[device.buildingId].devices.push(device.id);
        });

        // Format buildings for the dropdown
        const formattedBuildings = Object.values(buildings);

        return {
          success: true,
          devices: formattedDevices,
          buildings: formattedBuildings
        };
      } catch (deviceErr) {
        homey.app.error('Error getting device list:', deviceErr);
        return {
          success: false,
          error: `Failed to get device list: ${deviceErr.message}`
        };
      }
    } catch (err) {
      console.error('Error in getDeviceList:', err);
      return { success: false, error: err.message };
    }
  },

  async getTestLogging({ homey }) {
    try {
      console.log('API method getTestLogging called');
      homey.app.log('API method getTestLogging called');

      // Log test messages directly
      homey.app.log('===== TEST LOGGING STARTED =====');
      homey.app.log('This is a test debug message');
      homey.app.log('This is a test info message');
      homey.app.log('This is a test warning message');
      homey.app.error('This is a test error message');

      // Log some system information
      homey.app.log('System Information:');
      homey.app.log('- App ID:', homey.app.id);
      homey.app.log('- App Version:', homey.manifest.version);
      homey.app.log('- Homey Version:', homey.version);
      homey.app.log('- Node.js Version:', process.version);

      // Log current date and time
      homey.app.log('Current Date/Time:', new Date().toISOString());

      // Log settings
      const settings = {
        melcloud_user: homey.settings.get('melcloud_user') ? '✓ Set' : '✗ Not set',
        melcloud_pass: homey.settings.get('melcloud_pass') ? '✓ Set' : '✗ Not set',
        tibber_token: homey.settings.get('tibber_token') ? '✓ Set' : '✗ Not set',
        device_id: homey.settings.get('device_id'),
        building_id: homey.settings.get('building_id'),
        min_temp: homey.settings.get('min_temp'),
        max_temp: homey.settings.get('max_temp'),
        temp_step_max: homey.settings.get('temp_step_max'),
        initial_k: homey.settings.get('initial_k'),
        // Zone2 settings
        enable_zone2: homey.settings.get('enable_zone2'),
        min_temp_zone2: homey.settings.get('min_temp_zone2'),
        max_temp_zone2: homey.settings.get('max_temp_zone2'),
        temp_step_zone2: homey.settings.get('temp_step_zone2'),
        // Hot water tank settings
        enable_tank_control: homey.settings.get('enable_tank_control'),
        min_tank_temp: homey.settings.get('min_tank_temp'),
        max_tank_temp: homey.settings.get('max_tank_temp'),
        tank_temp_step: homey.settings.get('tank_temp_step')
      };

      homey.app.log('Settings:', JSON.stringify(settings, null, 2));

      // Try to initialize services to test connections
      try {
        await initializeServices(homey);
        homey.app.log('Successfully initialized services');

        // Try to get device state
        const deviceId = homey.settings.get('device_id');
        const buildingId = parseInt(homey.settings.get('building_id'));

        if (deviceId && buildingId) {
          const deviceState = await melCloud.getDeviceState(deviceId, buildingId);
          homey.app.log('Successfully retrieved device state:');

          // Handle different device types
          if (deviceState.SetTemperatureZone1 !== undefined) {
            // This is an ATW device (like a boiler)
            homey.app.log(`- Room Temperature Zone1: ${deviceState.RoomTemperatureZone1 || 'N/A'}°C`);
            homey.app.log(`- Set Temperature Zone1: ${deviceState.SetTemperatureZone1}°C`);
            homey.app.log(`- Power: ${deviceState.Power ? 'On' : 'Off'}`);
            homey.app.log(`- Operation Mode: ${deviceState.OperationMode}`);
            homey.app.log(`- Operation Mode Zone1: ${deviceState.OperationModeZone1}`);

            // Check if tank water temperature is available
            if (deviceState.SetTankWaterTemperature !== undefined) {
              homey.app.log(`- Tank Water Temperature: ${deviceState.TankWaterTemperature || 'N/A'}°C`);
              homey.app.log(`- Set Tank Water Temperature: ${deviceState.SetTankWaterTemperature}°C`);
            }

            settings.device_state = {
              room_temp_zone1: deviceState.RoomTemperatureZone1,
              set_temp_zone1: deviceState.SetTemperatureZone1,
              power: deviceState.Power,
              mode: deviceState.OperationMode,
              mode_zone1: deviceState.OperationModeZone1,
              tank_water_temp: deviceState.TankWaterTemperature,
              set_tank_water_temp: deviceState.SetTankWaterTemperature
            };
          } else {
            // This is a regular device
            homey.app.log(`- Room Temperature: ${deviceState.RoomTemperature || 'N/A'}°C`);
            homey.app.log(`- Set Temperature: ${deviceState.SetTemperature}°C`);
            homey.app.log(`- Power: ${deviceState.Power ? 'On' : 'Off'}`);
            homey.app.log(`- Operation Mode: ${deviceState.OperationMode}`);

            settings.device_state = {
              room_temp: deviceState.RoomTemperature,
              set_temp: deviceState.SetTemperature,
              power: deviceState.Power,
              mode: deviceState.OperationMode
            };
          }
        }

        // Try to get prices
        const priceData = await tibber.getPrices();
        homey.app.log('Successfully retrieved price data:');
        homey.app.log(`- Current Price: ${priceData.current.price}`);
        homey.app.log(`- Number of Price Points: ${priceData.prices.length}`);

        settings.price_data = {
          current_price: priceData.current.price,
          price_points: priceData.prices.length
        };
      } catch (initErr) {
        homey.app.error('Error initializing services:', initErr);
        settings.init_error = initErr.message;
      }

      homey.app.log('===== TEST LOGGING COMPLETED =====');

      return { success: true, message: 'Test logging completed', settings };
    } catch (err) {
      console.error('Error in getTestLogging:', err);
      return { success: false, error: err.message };
    }
  },

  async getRunHourlyOptimizer({ homey }) {
    try {
      console.log('API method getRunHourlyOptimizer called');
      homey.app.log('API method getRunHourlyOptimizer called');

      // Initialize services if needed
      try {
        await initializeServices(homey);

        // Update optimizer with the latest settings
        await updateOptimizerSettings(homey);
      } catch (initErr) {
        return {
          success: false,
          error: `Failed to initialize services: ${initErr.message}`,
          needsConfiguration: true
        };
      }

      // Run hourly optimization
      homey.app.log('Starting hourly optimization');
      homey.app.log('===== HOURLY OPTIMIZATION STARTED =====');

      try {
        // Run the actual optimization
        const result = await optimizer.runHourlyOptimization();

        // Log the result
        homey.app.log('Optimization result:', JSON.stringify(result, null, 2));

        // Log to timeline (using app.log for now)
        homey.app.log(`🔄 TIMELINE: Optimized Zone1 temperature to ${result.targetTemp}°C (was ${result.targetOriginal}°C)`);

        // Log Zone2 temperature changes if available
        if (result.zone2Temperature) {
          homey.app.log(`🔄 TIMELINE: Optimized Zone2 temperature to ${result.zone2Temperature.targetTemp}°C (was ${result.zone2Temperature.targetOriginal}°C)`);
        }

        // Log tank temperature changes if available
        if (result.tankTemperature) {
          homey.app.log(`💧 TIMELINE: Optimized tank temperature to ${result.tankTemperature.targetTemp}°C (was ${result.tankTemperature.targetOriginal}°C)`);
        }

        // Send to timeline using the Homey SDK 3.0 API
        try {
          // Prepare message including Zone1, Zone2, and tank temperature if available
          let message = `Optimized Zone1 temperature to ${result.targetTemp}°C (was ${result.targetOriginal}°C)`;

          if (result.zone2Temperature) {
            message += `. Zone2 temperature to ${result.zone2Temperature.targetTemp}°C (was ${result.zone2Temperature.targetOriginal}°C)`;
          }

          if (result.tankTemperature) {
            message += `. Tank temperature to ${result.tankTemperature.targetTemp}°C (was ${result.tankTemperature.targetOriginal}°C)`;
          }

          // First try the direct timeline API if available
          if (typeof homey.timeline === 'object' && typeof homey.timeline.createEntry === 'function') {
            await homey.timeline.createEntry({
              title: 'MELCloud Optimizer',
              body: message,
              icon: 'flow:device_changed'
            });
            homey.app.log('Timeline entry created using timeline API');
          }
          // Then try the notifications API as a fallback
          else if (typeof homey.notifications === 'object' && typeof homey.notifications.createNotification === 'function') {
            await homey.notifications.createNotification({
              excerpt: `MELCloud Optimizer: ${message}`,
            });
            homey.app.log('Timeline entry created using notifications API');
          }
          // Finally try the flow API as a last resort
          else if (homey.app && homey.app.flow && typeof homey.app.flow.runFlowCardAction === 'function') {
            await homey.app.flow.runFlowCardAction({
              uri: 'homey:manager:timeline',
              id: 'createEntry',
              args: {
                title: 'MELCloud Optimizer',
                message: message,
                icon: 'flow:device_changed'
              }
            });
            homey.app.log('Timeline entry created using flow API');
          }
          else {
            homey.app.log('No timeline API available, using log only');
          }
        } catch (timelineErr) {
          homey.app.log('Timeline logging failed:', timelineErr.message);
        }

        homey.app.log('===== HOURLY OPTIMIZATION COMPLETED SUCCESSFULLY =====');

        return {
          success: true,
          message: 'Hourly optimization completed',
          result
        };
      } catch (optimizeErr) {
        homey.app.error('Hourly optimization error', optimizeErr);

        // Log notification
        homey.app.error(`NOTIFICATION: HourlyOptimizer error: ${optimizeErr.message}`);

        // Try to send notification if the method exists
        try {
          if (typeof homey.notifications === 'object' && typeof homey.notifications.createNotification === 'function') {
            await homey.notifications.createNotification({ excerpt: `HourlyOptimizer error: ${optimizeErr.message}` });
          }
        } catch (notifyErr) {
          homey.app.error('Notification system not available:', notifyErr.message);
        }

        homey.app.error('===== HOURLY OPTIMIZATION FAILED =====');
        throw optimizeErr; // Re-throw to be caught by the outer try-catch
      }
    } catch (err) {
      console.error('Error in getRunHourlyOptimizer:', err);
      return { success: false, error: err.message };
    }
  },

  async getRunWeeklyCalibration({ homey }) {
    try {
      console.log('API method getRunWeeklyCalibration called');
      homey.app.log('API method getRunWeeklyCalibration called');

      // Initialize services if needed
      try {
        await initializeServices(homey);

        // Update optimizer with the latest settings
        await updateOptimizerSettings(homey);
      } catch (initErr) {
        return {
          success: false,
          error: `Failed to initialize services: ${initErr.message}`,
          needsConfiguration: true
        };
      }

      // Run weekly calibration
      homey.app.log('Starting weekly calibration');
      homey.app.log('===== WEEKLY CALIBRATION STARTED =====');

      try {
        // Check if we have historical data
        if (historicalData.optimizations.length < 24) {
          const message = `Not enough historical data for calibration. Have ${historicalData.optimizations.length} data points, need at least 24.`;
          homey.app.log(message);

          return {
            success: false,
            message: message,
            historicalDataCount: historicalData.optimizations.length
          };
        }

        // Run the actual calibration
        const result = await optimizer.runWeeklyCalibration();

        // Log the result
        homey.app.log('Calibration result:', JSON.stringify(result, null, 2));

        // Log to timeline (using app.log for now)
        homey.app.log(`📊 TIMELINE: Calibrated thermal model: K=${result.newK.toFixed(2)}`);

        // If OpenAI was used, log the analysis
        if (result.analysis && result.analysis.length > 0) {
          // Truncate analysis if it's too long
          const maxLength = 200;
          const truncatedAnalysis = result.analysis.length > maxLength
            ? result.analysis.substring(0, maxLength) + '...'
            : result.analysis;

          homey.app.log(`🤖 TIMELINE: AI Analysis: ${truncatedAnalysis}`);
        }

        // Send to timeline using the Homey SDK 3.0 API
        try {
          // First try the direct timeline API if available
          if (typeof homey.timeline === 'object' && typeof homey.timeline.createEntry === 'function') {
            await homey.timeline.createEntry({
              title: 'MELCloud Optimizer',
              body: `Calibrated thermal model: K=${result.newK.toFixed(2)}`,
              icon: 'flow:device_changed'
            });
            homey.app.log('Timeline entry created using timeline API');

            // If OpenAI was used, add another entry
            if (result.analysis && result.analysis.length > 0) {
              const maxLength = 200;
              const truncatedAnalysis = result.analysis.length > maxLength
                ? result.analysis.substring(0, maxLength) + '...'
                : result.analysis;

              await homey.timeline.createEntry({
                title: 'MELCloud Optimizer AI Analysis',
                body: truncatedAnalysis,
                icon: 'flow:device_changed'
              });
            }
          }
          // Then try the notifications API as a fallback
          else if (typeof homey.notifications === 'object' && typeof homey.notifications.createNotification === 'function') {
            await homey.notifications.createNotification({
              excerpt: `MELCloud Optimizer: Calibrated thermal model: K=${result.newK.toFixed(2)}`,
            });
            homey.app.log('Timeline entry created using notifications API');

            // If OpenAI was used, add another notification
            if (result.analysis && result.analysis.length > 0) {
              const maxLength = 200;
              const truncatedAnalysis = result.analysis.length > maxLength
                ? result.analysis.substring(0, maxLength) + '...'
                : result.analysis;

              await homey.notifications.createNotification({
                excerpt: `MELCloud Optimizer AI Analysis: ${truncatedAnalysis}`,
              });
            }
          }
          // Finally try the flow API as a last resort
          else if (homey.app && homey.app.flow && typeof homey.app.flow.runFlowCardAction === 'function') {
            await homey.app.flow.runFlowCardAction({
              uri: 'homey:manager:timeline',
              id: 'createEntry',
              args: {
                title: 'MELCloud Optimizer',
                message: `Calibrated thermal model: K=${result.newK.toFixed(2)}`,
                icon: 'flow:device_changed'
              }
            });
            homey.app.log('Timeline entry created using flow API');

            // If OpenAI was used, add another entry
            if (result.analysis && result.analysis.length > 0) {
              const maxLength = 200;
              const truncatedAnalysis = result.analysis.length > maxLength
                ? result.analysis.substring(0, maxLength) + '...'
                : result.analysis;

              await homey.app.flow.runFlowCardAction({
                uri: 'homey:manager:timeline',
                id: 'createEntry',
                args: {
                  title: 'MELCloud Optimizer AI Analysis',
                  message: truncatedAnalysis,
                  icon: 'flow:device_changed'
                }
              });
            }
          }
          else {
            homey.app.log('No timeline API available, using log only');
          }
        } catch (timelineErr) {
          homey.app.log('Timeline logging failed:', timelineErr.message);
        }

        // Update settings
        homey.settings.set('initial_k', result.newK);

        homey.app.log('===== WEEKLY CALIBRATION COMPLETED SUCCESSFULLY =====');

        return {
          success: true,
          message: 'Weekly calibration completed',
          result
        };
      } catch (calibrateErr) {
        homey.app.error('Weekly calibration error', calibrateErr);

        // Log notification
        homey.app.error(`NOTIFICATION: WeeklyCalibration error: ${calibrateErr.message}`);

        // Try to send notification if the method exists
        try {
          if (typeof homey.notifications === 'object' && typeof homey.notifications.createNotification === 'function') {
            await homey.notifications.createNotification({ excerpt: `WeeklyCalibration error: ${calibrateErr.message}` });
          }
        } catch (notifyErr) {
          homey.app.error('Notification system not available:', notifyErr.message);
        }

        homey.app.error('===== WEEKLY CALIBRATION FAILED =====');
        throw calibrateErr; // Re-throw to be caught by the outer try-catch
      }
    } catch (err) {
      console.error('Error in getRunWeeklyCalibration:', err);
      return { success: false, error: err.message };
    }
  },

  async getStartCronJobs({ homey }) {
    try {
      console.log('API method getStartCronJobs called');
      homey.app.log('API method getStartCronJobs called');

      // Try to initialize the cron jobs directly in the API
      try {
        homey.app.log('Initializing cron jobs directly in the API');

        // Import the cron library
        const { CronJob } = require('cron');

        // Create hourly job - runs at minute 5 of every hour
        homey.app.log('Creating hourly cron job with pattern: 0 5 * * * *');
        const hourlyJob = new CronJob('0 5 * * * *', async () => {
          // Log the trigger
          const currentTime = new Date().toISOString();
          homey.app.log('===== AUTOMATIC HOURLY CRON JOB TRIGGERED =====');
          homey.app.log(`Current time: ${currentTime}`);

          // Store the last run time in settings
          homey.settings.set('last_hourly_run', currentTime);

          // Add a timeline entry for the automatic trigger
          try {
            homey.app.log('Creating timeline entry for hourly job');
            await homey.flow.runFlowCardAction({
              uri: 'homey:flowcardaction:homey:manager:timeline:log',
              args: { text: '🕒 Automatic hourly optimization triggered' }
            });
            homey.app.log('Timeline entry created successfully');
          } catch (err) {
            homey.app.error('Failed to create timeline entry for automatic trigger', err);

            // Try an alternative method if the first one fails
            try {
              homey.app.log('Trying alternative method for timeline entry');
              await homey.notifications.createNotification({ excerpt: '🕒 Automatic hourly optimization triggered' });
              homey.app.log('Notification created successfully');
            } catch (notifyErr) {
              homey.app.error('Failed to create notification', notifyErr);
            }
          }

          // Call the hourly optimizer
          try {
            await this.getRunHourlyOptimizer({ homey });
          } catch (err) {
            homey.app.error('Error in hourly cron job', err);
          }
        });

        // Create weekly job - runs at 2:05 AM on Sundays
        homey.app.log('Creating weekly cron job with pattern: 0 5 2 * * 0');
        const weeklyJob = new CronJob('0 5 2 * * 0', async () => {
          // Log the trigger
          const currentTime = new Date().toISOString();
          homey.app.log('===== AUTOMATIC WEEKLY CRON JOB TRIGGERED =====');
          homey.app.log(`Current time: ${currentTime}`);

          // Store the last run time in settings
          homey.settings.set('last_weekly_run', currentTime);

          // Add a timeline entry for the automatic trigger
          try {
            homey.app.log('Creating timeline entry for weekly job');
            await homey.flow.runFlowCardAction({
              uri: 'homey:flowcardaction:homey:manager:timeline:log',
              args: { text: '📊 Automatic weekly calibration triggered' }
            });
            homey.app.log('Timeline entry created successfully');
          } catch (err) {
            homey.app.error('Failed to create timeline entry for automatic trigger', err);

            // Try an alternative method if the first one fails
            try {
              homey.app.log('Trying alternative method for timeline entry');
              await homey.notifications.createNotification({ excerpt: '📊 Automatic weekly calibration triggered' });
              homey.app.log('Notification created successfully');
            } catch (notifyErr) {
              homey.app.error('Failed to create notification', notifyErr);
            }
          }

          // Call the weekly calibration
          try {
            await this.getRunWeeklyCalibration({ homey });
          } catch (err) {
            homey.app.error('Error in weekly cron job', err);
          }
        });

        // Start the cron jobs
        homey.app.log('Starting hourly cron job...');
        hourlyJob.start();
        homey.app.log('Hourly cron job started');

        homey.app.log('Starting weekly cron job...');
        weeklyJob.start();
        homey.app.log('Weekly cron job started');

        // Store the jobs in settings for future reference
        homey.settings.set('cron_status', {
          hourlyJob: {
            running: hourlyJob.running,
            nextRun: hourlyJob.nextDate().toString(),
            cronTime: hourlyJob.cronTime.source
          },
          weeklyJob: {
            running: weeklyJob.running,
            nextRun: weeklyJob.nextDate().toString(),
            cronTime: weeklyJob.cronTime.source
          },
          lastHourlyRun: homey.settings.get('last_hourly_run') || 'Never',
          lastWeeklyRun: homey.settings.get('last_weekly_run') || 'Never',
          lastUpdated: new Date().toISOString()
        });

        // Store the jobs in global variables for future access
        global.hourlyJob = hourlyJob;
        global.weeklyJob = weeklyJob;

        // Add a timeline entry for the cron job initialization
        try {
          homey.app.log('Creating timeline entry for cron job initialization');
          await homey.flow.runFlowCardAction({
            uri: 'homey:flowcardaction:homey:manager:timeline:log',
            args: { text: '🕓 Scheduled jobs initialized' }
          });
          homey.app.log('Timeline entry created successfully');
        } catch (err) {
          homey.app.error('Failed to create timeline entry for cron job initialization', err);

          // Try an alternative method if the first one fails
          try {
            homey.app.log('Trying alternative method for timeline entry');
            await homey.notifications.createNotification({ excerpt: '🕓 Scheduled jobs initialized' });
            homey.app.log('Notification created successfully');
          } catch (notifyErr) {
            homey.app.error('Failed to create notification', notifyErr);
          }
        }

        // Update the cron status in settings
        await this.getUpdateCronStatus({ homey });

        return {
          success: true,
          message: 'Cron jobs initialized directly in the API',
          hourlyJobRunning: hourlyJob.running,
          weeklyJobRunning: weeklyJob.running
        };
      } catch (err) {
        homey.app.error('Error initializing cron jobs directly in the API:', err);
        return {
          success: false,
          error: err.message || 'Unknown error'
        };
      }
    } catch (err) {
      console.error('Error in getStartCronJobs:', err);
      return { success: false, error: err.message };
    }
  },

  async getUpdateCronStatus({ homey }) {
    try {
      console.log('API method getUpdateCronStatus called');
      homey.app.log('API method getUpdateCronStatus called');

      // Manually update the cron status in settings
      try {
        // Get the hourly and weekly jobs from the app instance if possible
        let hourlyJob = null;
        let weeklyJob = null;

        try {
          // First try to access the global cron jobs
          if (global.hourlyJob && global.weeklyJob) {
            hourlyJob = global.hourlyJob;
            weeklyJob = global.weeklyJob;
            homey.app.log('Successfully accessed cron jobs from global variables');
          }
          // If not found in global, try to access from app instance
          else if (homey.app && typeof homey.app === 'object') {
            hourlyJob = homey.app.hourlyJob;
            weeklyJob = homey.app.weeklyJob;

            if (hourlyJob && weeklyJob) {
              homey.app.log('Successfully accessed cron jobs from app instance');
            } else {
              homey.app.log('Cron jobs not found in app instance');
              homey.app.log('hourlyJob:', hourlyJob ? 'found' : 'not found');
              homey.app.log('weeklyJob:', weeklyJob ? 'found' : 'not found');
            }
          } else {
            homey.app.log('homey.app is not accessible or not an object');
          }
        } catch (err) {
          homey.app.log('Could not access cron jobs from app instance:', err.message);
        }

        // Create a status object with the available information
        const status = {
          hourlyJob: hourlyJob ? {
            running: hourlyJob.running,
            nextRun: hourlyJob.nextDate().toString(),
            cronTime: hourlyJob.cronTime.source
          } : { running: false, error: 'Could not access hourly job' },

          weeklyJob: weeklyJob ? {
            running: weeklyJob.running,
            nextRun: weeklyJob.nextDate().toString(),
            cronTime: weeklyJob.cronTime.source
          } : { running: false, error: 'Could not access weekly job' },

          lastHourlyRun: homey.settings.get('last_hourly_run') || 'Never',
          lastWeeklyRun: homey.settings.get('last_weekly_run') || 'Never',
          lastUpdated: new Date().toISOString()
        };

        // Save the status to settings
        homey.settings.set('cron_status', status);
        homey.app.log('Manually updated cron status in settings');

        return {
          success: true,
          message: 'Cron status updated successfully',
          cronStatus: status
        };
      } catch (err) {
        homey.app.error('Error updating cron status:', err);
        return {
          success: false,
          error: err.message || 'Unknown error'
        };
      }
    } catch (err) {
      console.error('Error in getUpdateCronStatus:', err);
      return { success: false, error: err.message };
    }
  },

  async getCheckCronStatus({ homey }) {
    try {
      console.log('API method getCheckCronStatus called');
      homey.app.log('API method getCheckCronStatus called');

      // Check if the global cron jobs exist
      if (!global.hourlyJob || !global.weeklyJob) {
        homey.app.log('Global cron jobs not found, attempting to start them');

        // Try to start the cron jobs
        try {
          const startResult = await this.getStartCronJobs({ homey });
          if (startResult.success) {
            homey.app.log('Successfully started cron jobs via API');
          } else {
            homey.app.log('Failed to start cron jobs via API:', startResult.error);
          }
        } catch (err) {
          homey.app.error('Error calling getStartCronJobs:', err);
        }
      }

      // Try to get the latest cron status by calling the update endpoint
      try {
        // Call the update endpoint to get the latest status
        const updateResult = await this.getUpdateCronStatus({ homey });
        if (updateResult.success) {
          homey.app.log('Successfully updated cron status via API');
        } else {
          homey.app.log('Failed to update cron status via API:', updateResult.error);
        }
      } catch (err) {
        homey.app.error('Error calling getUpdateCronStatus:', err);
      }

      // Get information about the cron jobs from settings
      const cronStatus = homey.settings.get('cron_status') || {
        hourlyJob: { running: false, error: 'Cron status not available in settings' },
        weeklyJob: { running: false, error: 'Cron status not available in settings' },
        lastHourlyRun: homey.settings.get('last_hourly_run') || 'Never',
        lastWeeklyRun: homey.settings.get('last_weekly_run') || 'Never',
        lastUpdated: new Date().toISOString()
      };

      // Add last run times if not present in cronStatus
      if (!cronStatus.lastHourlyRun) {
        cronStatus.lastHourlyRun = homey.settings.get('last_hourly_run') || 'Never';
      }

      if (!cronStatus.lastWeeklyRun) {
        cronStatus.lastWeeklyRun = homey.settings.get('last_weekly_run') || 'Never';
      }

      // Get the current time for reference
      const currentTime = new Date().toISOString();

      // Log the cron status for debugging
      homey.app.log('Cron status:', JSON.stringify(cronStatus, null, 2));

      // Create a timeline entry to show the cron status
      try {
        // Use homey.app.flow instead of homey.flow
        if (homey.app && homey.app.flow && typeof homey.app.flow.runFlowCardAction === 'function') {
          await homey.app.flow.runFlowCardAction({
            uri: 'homey:flowcardaction:homey:manager:timeline:log',
            args: { text: '⏱️ Cron job status checked' }
          });
          homey.app.log('Timeline entry created for cron status check');
        } else {
          homey.app.log('Timeline API not available, using log only');
        }
      } catch (err) {
        homey.app.error('Failed to create timeline entry for cron status check', err);
      }

      return {
        success: true,
        currentTime,
        hourlyJob: cronStatus.hourlyJob,
        weeklyJob: cronStatus.weeklyJob,
        lastHourlyRun: cronStatus.lastHourlyRun,
        lastWeeklyRun: cronStatus.lastWeeklyRun
      };
    } catch (err) {
      console.error('Error in getCheckCronStatus:', err);
      return { success: false, error: err.message };
    }
  }
};
