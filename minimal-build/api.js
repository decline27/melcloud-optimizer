// We can't import the TypeScript services directly in the API
// Instead, we'll implement simplified versions of the services here

// Import the HTTPS module
const https = require('https');

// Helper function for making HTTP requests
function httpRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    console.log(`Making ${options.method} request to ${options.hostname}${options.path}`);

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

    if (data) {
      const dataStr = JSON.stringify(data);
      console.log(`Request data: ${dataStr.substring(0, 100)}...`);
      req.write(dataStr);
    }

    req.end();
  });
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
  findDevicesInObject(obj, buildingId, path = '', foundDeviceIds = new Set()) {
    const devices = [];

    // If this is null or not an object, return empty array
    if (!obj || typeof obj !== 'object') {
      return devices;
    }

    // If this is an array, search each item
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        const foundDevices = this.findDevicesInObject(item, buildingId, `${path}[${index}]`, foundDeviceIds);
        devices.push(...foundDevices);
      });
      return devices;
    }

    // Check if this object looks like a device
    if (obj.DeviceID !== undefined && obj.DeviceName !== undefined) {
      // Only add the device if we haven't seen this ID before
      if (!foundDeviceIds.has(obj.DeviceID)) {
        console.log(`Found device at ${path}: ${obj.DeviceName} (ID: ${obj.DeviceID})`);
        foundDeviceIds.add(obj.DeviceID);
        devices.push({
          id: obj.DeviceID,
          name: obj.DeviceName || `Device ${obj.DeviceID}`,
          buildingId: buildingId,
          type: 'heat_pump',
          data: obj,
        });
      } else {
        console.log(`Skipping duplicate device at ${path}: ${obj.DeviceName} (ID: ${obj.DeviceID})`);
      }
    }

    // Check if this is a device list
    if (obj.Devices && Array.isArray(obj.Devices)) {
      console.log(`Found device list at ${path} with ${obj.Devices.length} devices`);
      obj.Devices.forEach(device => {
        if (device.DeviceID !== undefined) {
          // Only add the device if we haven't seen this ID before
          if (!foundDeviceIds.has(device.DeviceID)) {
            console.log(`  Device: ${device.DeviceName || 'Unknown'} (ID: ${device.DeviceID})`);
            foundDeviceIds.add(device.DeviceID);
            devices.push({
              id: device.DeviceID,
              name: device.DeviceName || `Device ${device.DeviceID}`,
              buildingId: buildingId,
              type: 'heat_pump',
              data: device,
            });
          } else {
            console.log(`  Skipping duplicate device: ${device.DeviceName || 'Unknown'} (ID: ${device.DeviceID})`);
          }
        }
      });
    }

    // Recursively search all properties
    Object.keys(obj).forEach(key => {
      // Skip some common properties that are unlikely to contain devices
      if (['ID', 'Name', 'Address', 'City', 'Country', 'PostalCode', 'Icon', 'Latitude', 'Longitude'].includes(key)) {
        return;
      }

      const foundDevices = this.findDevicesInObject(obj[key], buildingId, `${path}.${key}`, foundDeviceIds);
      devices.push(...foundDevices);
    });

    return devices;
  }

  async getDeviceState(deviceId, buildingId) {
    try {
      if (!this.contextKey) {
        throw new Error('Not logged in to MELCloud');
      }

      // Check if deviceId is a valid number
      if (isNaN(parseInt(deviceId))) {
        // If deviceId is a string (like 'Boiler'), try to find the actual device ID
        if (this.devices.length === 0) {
          // If no devices were found, throw an error
          throw new Error(`No devices found in MELCloud account. Please check your MELCloud credentials and device ID.`);
        }

        // Try to find a device with a matching name
        const matchingDevice = this.devices.find(device => device.name.toLowerCase() === deviceId.toLowerCase());

        if (matchingDevice) {
          console.log(`Found device with name ${deviceId}: ID=${matchingDevice.id}, BuildingID=${matchingDevice.buildingId}`);
          deviceId = matchingDevice.id;
          buildingId = matchingDevice.buildingId;
        } else {
          // If no matching device was found, use the first device
          console.log(`No device found with name ${deviceId}. Using first device: ID=${this.devices[0].id}, BuildingID=${this.devices[0].buildingId}`);
          deviceId = this.devices[0].id;
          buildingId = this.devices[0].buildingId;
        }
      }

      // Check if this is a dummy device
      const device = this.devices.find(d => d.id.toString() === deviceId.toString());
      if (device && device.isDummy) {
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

  async setDeviceTemperature(deviceId, buildingId, temperature) {
    try {
      if (!this.contextKey) {
        throw new Error('Not logged in to MELCloud');
      }

      console.log(`Setting temperature for device ${deviceId} to ${temperature}°C...`);

      // First get current state (this will handle device ID resolution)
      const currentState = await this.getDeviceState(deviceId, buildingId);

      // Check if this is a dummy device
      const device = this.devices.find(d => d.id.toString() === currentState.DeviceID?.toString());
      if (device && device.isDummy) {
        console.log(`Using dummy device - simulating temperature change for device ${currentState.DeviceID}`);
        // Update the dummy device data
        device.data.SetTemperature = temperature;
        console.log(`Successfully set temperature for dummy device ${currentState.DeviceID} to ${temperature}°C`);
        return true;
      }

      // For ATW (Air to Water) devices, we need to set the zone temperature (only Zone1 is used)
      if (currentState.SetTemperatureZone1 !== undefined) {
        console.log('Detected ATW (Air to Water) device, setting Zone1 temperature only');

        // Log the current operation modes and other important settings
        console.log(`Current device state:`);
        console.log(`- Power: ${currentState.Power}`);
        console.log(`- OperationMode: ${currentState.OperationMode}`);
        console.log(`- OperationModeZone1: ${currentState.OperationModeZone1}`);
        console.log(`- IdleZone1: ${currentState.IdleZone1}`);
        console.log(`- Current Zone1 temp: ${currentState.SetTemperatureZone1}°C`);

        // Try a more minimal approach - only send the essential fields
        // Create a new minimal request body with only the necessary fields
        const requestBody = {
          DeviceID: currentState.DeviceID,
          BuildingID: currentState.BuildingID || buildingId,
          SetTemperatureZone1: Math.round(parseFloat(temperature)),
          // Keep the original Zone2 temperature
          SetTemperatureZone2: currentState.SetTemperatureZone2,
          // Keep the original room temperatures
          RoomTemperatureZone1: currentState.RoomTemperatureZone1,
          RoomTemperatureZone2: currentState.RoomTemperatureZone2,
          Power: true,
          EffectiveFlags: 1,
          HasPendingCommand: true,
          OperationMode: currentState.OperationMode,
          OperationModeZone1: currentState.OperationModeZone1, // Keep the original operation mode
          OperationModeZone2: currentState.OperationModeZone2, // Keep the original Zone2 operation mode
          IdleZone1: false,
          IdleZone2: currentState.IdleZone2, // Keep the original Zone2 idle state
          // Include device type information
          DeviceType: currentState.DeviceType,
          // Include heat flow temperatures
          SetHeatFlowTemperatureZone1: currentState.SetHeatFlowTemperatureZone1,
          SetHeatFlowTemperatureZone2: currentState.SetHeatFlowTemperatureZone2
        };

        console.log('Using minimal request body approach');

        // Log the changes we're making
        console.log(`Current state before change: Zone1=${currentState.SetTemperatureZone1}°C, Zone2=${currentState.SetTemperatureZone2 || 'N/A'}°C`);
        console.log(`Setting new temperature: Zone1=${requestBody.SetTemperatureZone1}°C`);

        // Try a different endpoint - use the Device/Set endpoint instead of Device/SetAtw
        const baseUrlObj = new URL(this.baseUrl);
        const options = {
          hostname: baseUrlObj.hostname,
          path: '/Mitsubishi.Wifi.Client/Device/Set',  // Changed to Device/Set which might be more general
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-MitsContextKey': this.contextKey,
          }
        };

        console.log('Using Device/Set endpoint instead of Device/SetAtw');

        // Log the request body for debugging
        console.log('Device/Set request body:', JSON.stringify(requestBody));

        const data = await httpRequest(options, requestBody);

        // Verify that the temperature was actually set by checking the response
        if (data && data.SetTemperatureZone1 !== undefined) {
          const actualTemp = data.SetTemperatureZone1;
          if (Math.round(actualTemp) === Math.round(parseFloat(temperature))) {
            console.log(`Successfully set Zone1 temperature for device ${requestBody.DeviceID || deviceId} to ${temperature}°C`);
            return true;
          } else {
            console.log(`WARNING: Attempted to set Zone1 temperature to ${temperature}°C but API returned ${actualTemp}°C`);
            console.log('Full response data:', JSON.stringify(data).substring(0, 500));
            return false;
          }
        } else {
          console.log(`WARNING: Could not verify temperature change, API response does not contain SetTemperatureZone1`);
          console.log('Full response data:', JSON.stringify(data).substring(0, 500));
          return data !== null;
        }
      } else {
        // For regular devices, set the main temperature
        const requestBody = {
          DeviceID: currentState.DeviceID,
          SetTemperature: parseFloat(temperature),
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

        const data = await httpRequest(options, requestBody);

        console.log(`Successfully set temperature for device ${requestBody.DeviceID || deviceId} to ${temperature}°C`);
        return data !== null;
      }
    } catch (error) {
      console.error(`MELCloud set temperature error for device ${deviceId}:`, error);
      throw error; // Re-throw the error to be handled by the caller
    }
  }
}

// Tibber API Service
class TibberApi {
  constructor(token) {
    this.token = token;
    this.apiEndpoint = 'https://api.tibber.com/v1-beta/gql';
  }

  async getPrices() {
    try {
      console.log('Getting prices from Tibber...');

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
                }
                today {
                  total
                  energy
                  tax
                  startsAt
                }
                tomorrow {
                  total
                  energy
                  tax
                  startsAt
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

      const data = await httpRequest(options, { query });

      if (data.errors) {
        throw new Error(`Tibber API error: ${data.errors[0].message}`);
      }

      // Format the price data
      const result = this.formatPriceData(data);
      console.log(`Got current price: ${result.current.price} and ${result.prices.length} future prices`);
      return result;
    } catch (error) {
      console.error('Tibber API error:', error);
      throw error;
    }
  }

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
    }));

    return {
      current: priceInfo.current ? {
        time: priceInfo.current.startsAt,
        price: priceInfo.current.total,
      } : null,
      prices,
    };
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

      const result = await httpRequest(options, body);

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
  constructor(melCloud, tibber, deviceId, buildingId, logger, openai) {
    this.melCloud = melCloud;
    this.tibber = tibber;
    this.deviceId = deviceId;
    this.buildingId = buildingId;
    this.logger = logger;
    this.openai = openai;
    this.thermalModel = { K: 0.5 };
    this.minTemp = 18;
    this.maxTemp = 22;
    this.tempStep = 0.5;
  }

  setThermalModel(K, S) {
    this.thermalModel = { K, S };
  }

  setTemperatureConstraints(minTemp, maxTemp, tempStep) {
    this.minTemp = minTemp;
    this.maxTemp = maxTemp;
    this.tempStep = tempStep;
  }

  async runHourlyOptimization() {
    this.logger.log('Starting hourly optimization');

    try {
      // Get current device state
      const deviceState = await this.melCloud.getDeviceState(this.deviceId, this.buildingId);

      // Handle different device types
      let currentTemp;
      let currentTarget;

      if (deviceState.SetTemperatureZone1 !== undefined) {
        // This is an ATW device (like a boiler)
        currentTemp = deviceState.RoomTemperatureZone1 || 21; // Default to 21 if not available
        currentTarget = deviceState.SetTemperatureZone1;
        this.logger.log(`ATW device detected: Zone1 temp ${currentTarget}°C`);
      } else {
        // This is a regular device
        currentTemp = deviceState.RoomTemperature || 21; // Default to 21 if not available
        currentTarget = deviceState.SetTemperature;
        this.logger.log(`Regular device detected: Set temp ${currentTarget}°C`);
      }

      // Get electricity prices
      const priceData = await this.tibber.getPrices();
      const currentPrice = priceData.current.price;

      // Calculate price statistics
      const prices = priceData.prices.map(p => p.price);
      const priceAvg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      const priceMin = Math.min(...prices);
      const priceMax = Math.max(...prices);

      // Calculate optimal temperature based on price
      let newTarget = this.calculateOptimalTemperature(currentPrice, priceAvg, priceMin, priceMax, currentTemp);

      // Apply constraints
      newTarget = Math.max(this.minTemp, Math.min(this.maxTemp, newTarget));

      // Apply step constraint (don't change by more than tempStep)
      const maxChange = this.tempStep;
      if (Math.abs(newTarget - currentTarget) > maxChange) {
        newTarget = currentTarget + (newTarget > currentTarget ? maxChange : -maxChange);
      }

      // Round to nearest 0.5°C
      newTarget = Math.round(newTarget * 2) / 2;

      // Calculate savings and comfort impact
      const savings = this.calculateSavings(currentTarget, newTarget, currentPrice);
      const comfort = this.calculateComfortImpact(currentTarget, newTarget);

      // Determine reason for change
      let reason = 'No change needed';
      if (newTarget < currentTarget) {
        reason = 'Price is above average, reducing temperature';
      } else if (newTarget > currentTarget) {
        reason = 'Price is below average, increasing temperature';
      }

      // Set new temperature if different
      if (newTarget !== currentTarget) {
        try {
          const success = await this.melCloud.setDeviceTemperature(this.deviceId, this.buildingId, newTarget);

          if (success) {
            this.logger.log(`Changed temperature from ${currentTarget}°C to ${newTarget}°C: ${reason}`);
          } else {
            this.logger.log(`WARNING: Failed to change temperature from ${currentTarget}°C to ${newTarget}°C - API returned success but temperature was not updated`);
            this.logger.log(`Will try again in the next hourly optimization`);
            // Don't throw an error, just log the warning
          }
        } catch (error) {
          this.logger.log(`Failed to change temperature from ${currentTarget}°C to ${newTarget}°C: ${error.message}`);
          throw new Error(`Failed to set temperature: ${error.message}`);
        }
      } else {
        this.logger.log(`Keeping temperature at ${currentTarget}°C: ${reason}`);
      }

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
        kFactor: this.thermalModel.K
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
          }
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
        newK,
        analysis,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error in weekly calibration', error);
      throw error;
    }
  }

  calculateOptimalTemperature(currentPrice, avgPrice, minPrice, maxPrice, currentTemp) {
    // Normalize price between 0 and 1
    const priceRange = maxPrice - minPrice;
    const normalizedPrice = priceRange > 0
      ? (currentPrice - minPrice) / priceRange
      : 0.5;

    // Invert (lower price = higher temperature)
    const invertedPrice = 1 - normalizedPrice;

    // Calculate temperature offset based on price
    // Range from -tempStep to +tempStep
    const tempRange = this.maxTemp - this.minTemp;
    const midTemp = (this.maxTemp + this.minTemp) / 2;

    // Calculate target based on price
    // When price is average, target is midTemp
    // When price is minimum, target is maxTemp
    // When price is maximum, target is minTemp
    const targetTemp = midTemp + (invertedPrice - 0.5) * tempRange;

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
}

// Create instances of services
let melCloud = null;
let tibber = null;
let openai = null;
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

    // Create Optimizer instance
    optimizer = new Optimizer(melCloud, tibber, deviceId, buildingId, homey.app, openai);

    // Configure optimizer
    const minTemp = homey.settings.get('min_temp') || 18;
    const maxTemp = homey.settings.get('max_temp') || 22;
    const tempStep = homey.settings.get('temp_step_max') || 0.5;
    const kFactor = homey.settings.get('initial_k') || 0.5;

    homey.app.log('Optimizer settings:');
    homey.app.log('- Min Temp:', minTemp);
    homey.app.log('- Max Temp:', maxTemp);
    homey.app.log('- Temp Step:', tempStep);
    homey.app.log('- K Factor:', kFactor);

    optimizer.setTemperatureConstraints(minTemp, maxTemp, tempStep);
    optimizer.setThermalModel(kFactor);

    homey.app.log('Services initialized successfully');
  } catch (err) {
    homey.app.error('Failed to initialize services:', err);
    throw err;
  }
}

module.exports = {
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
        initial_k: homey.settings.get('initial_k')
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
          homey.app.log(`- Room Temperature: ${deviceState.RoomTemperature}°C`);
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
        homey.app.log(`🔄 TIMELINE: Optimized temperature to ${result.targetTemp}°C (was ${result.targetOriginal}°C)`);

        // Send to timeline using the Homey SDK 3.0 API
        try {
          // First try the direct timeline API if available
          if (typeof homey.timeline === 'object' && typeof homey.timeline.createEntry === 'function') {
            // Create more informative message
            let body = `Optimized to ${result.targetTemp}°C (${result.targetTemp > result.targetOriginal ? '+' : ''}${(result.targetTemp - result.targetOriginal).toFixed(1)}°C)`;

            // Add reason if available
            if (result.reason) {
              // Extract first part of reason (before any parentheses or periods)
              const shortReason = result.reason.split(/[(.]/)[0].trim();
              body += ` | Reason: ${shortReason}`;
            }

            // Add price context
            if (result.priceNow !== undefined && result.priceAvg !== undefined) {
              const priceRatio = result.priceNow / result.priceAvg;
              let priceContext = '';
              if (priceRatio > 1.5) priceContext = 'Very high';
              else if (priceRatio > 1.2) priceContext = 'High';
              else if (priceRatio < 0.8) priceContext = 'Low';
              else if (priceRatio < 0.5) priceContext = 'Very low';
              else priceContext = 'Average';

              body += ` | Price: ${priceContext}`;
            }

            // Add COP if available
            if (result.cop && result.cop.current) {
              body += ` | COP: ${result.cop.current.toFixed(1)}`;
            }

            await homey.timeline.createEntry({
              title: 'MELCloud Optimizer',
              body: body,
              icon: 'flow:device_changed'
            });
            homey.app.log('Timeline entry created using timeline API');
          }
          // Then try the notifications API as a fallback
          else if (typeof homey.notifications === 'object' && typeof homey.notifications.createNotification === 'function') {
            // Create more informative message
            let excerpt = `Optimized to ${result.targetTemp}°C (${result.targetTemp > result.targetOriginal ? '+' : ''}${(result.targetTemp - result.targetOriginal).toFixed(1)}°C)`;

            // Add reason if available
            if (result.reason) {
              // Extract first part of reason (before any parentheses or periods)
              const shortReason = result.reason.split(/[(.]/)[0].trim();
              excerpt += ` | Reason: ${shortReason}`;
            }

            // Add price context
            if (result.priceNow !== undefined && result.priceAvg !== undefined) {
              const priceRatio = result.priceNow / result.priceAvg;
              let priceContext = '';
              if (priceRatio > 1.5) priceContext = 'Very high';
              else if (priceRatio > 1.2) priceContext = 'High';
              else if (priceRatio < 0.8) priceContext = 'Low';
              else if (priceRatio < 0.5) priceContext = 'Very low';
              else priceContext = 'Average';

              excerpt += ` | Price: ${priceContext}`;
            }

            await homey.notifications.createNotification({
              excerpt: `MELCloud Optimizer: ${excerpt}`,
            });
            homey.app.log('Timeline entry created using notifications API');
          }
          // Finally try the flow API as a last resort
          else if (typeof homey.flow === 'object' && typeof homey.flow.runFlowCardAction === 'function') {
            await homey.flow.runFlowCardAction({
              uri: 'homey:manager:timeline',
              id: 'createEntry',
              args: {
                title: 'MELCloud Optimizer',
                message: `Optimized to ${result.targetTemp}°C (${result.targetTemp > result.targetOriginal ? '+' : ''}${(result.targetTemp - result.targetOriginal).toFixed(1)}°C)${result.reason ? ` | ${result.reason.split(/[(.]/)[0].trim()}` : ''}${result.priceNow && result.priceAvg ? ` | Price: ${result.priceNow > result.priceAvg * 1.2 ? 'High' : result.priceNow < result.priceAvg * 0.8 ? 'Low' : 'Average'}` : ''}`,
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
            // Create more informative calibration message
            let body = `Calibrated: K=${result.newK.toFixed(2)}`;

            // Add change percentage if old K is available
            if (result.oldK) {
              const changePercent = ((result.newK - result.oldK) / result.oldK * 100);
              if (Math.abs(changePercent) > 1) {
                body += ` (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(0)}%)`;
              }
            }

            // Add S value if available
            if (result.newS) {
              body += ` | S=${result.newS.toFixed(2)}`;
            }

            // Add thermal characteristics if available
            if (result.thermalCharacteristics) {
              if (result.thermalCharacteristics.heatingRate) {
                body += ` | Heat rate: ${result.thermalCharacteristics.heatingRate.toFixed(3)}`;
              }
              if (result.thermalCharacteristics.coolingRate) {
                body += ` | Cool rate: ${result.thermalCharacteristics.coolingRate.toFixed(3)}`;
              }
            }

            await homey.timeline.createEntry({
              title: 'MELCloud Optimizer',
              body: body,
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
            // Create more informative calibration message
            let excerpt = `Calibrated: K=${result.newK.toFixed(2)}`;

            // Add change percentage if old K is available
            if (result.oldK) {
              const changePercent = ((result.newK - result.oldK) / result.oldK * 100);
              if (Math.abs(changePercent) > 1) {
                excerpt += ` (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(0)}%)`;
              }
            }

            // Add S value if available
            if (result.newS) {
              excerpt += ` | S=${result.newS.toFixed(2)}`;
            }

            // Add thermal characteristics if available
            if (result.thermalCharacteristics) {
              if (result.thermalCharacteristics.heatingRate) {
                excerpt += ` | Heat rate: ${result.thermalCharacteristics.heatingRate.toFixed(3)}`;
              }
            }

            await homey.notifications.createNotification({
              excerpt: `MELCloud Optimizer: ${excerpt}`,
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
          else if (typeof homey.flow === 'object' && typeof homey.flow.runFlowCardAction === 'function') {
            await homey.flow.runFlowCardAction({
              uri: 'homey:manager:timeline',
              id: 'createEntry',
              args: {
                title: 'MELCloud Optimizer',
                message: `Calibrated: K=${result.newK.toFixed(2)}${result.oldK ? ` (${((result.newK - result.oldK) / result.oldK * 100) > 0 ? '+' : ''}${((result.newK - result.oldK) / result.oldK * 100).toFixed(0)}%)` : ''}${result.newS ? ` | S=${result.newS.toFixed(2)}` : ''}`,
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

              await homey.flow.runFlowCardAction({
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
  }
};
