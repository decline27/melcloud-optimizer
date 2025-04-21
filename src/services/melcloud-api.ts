import fetch from 'node-fetch';

/**
 * MELCloud API Service
 * Handles communication with the MELCloud API
 */
export class MelCloudApi {
  private baseUrl = 'https://app.melcloud.com/Mitsubishi.Wifi.Client/';
  private contextKey: string | null = null;
  private devices: any[] = [];

  /**
   * Login to MELCloud
   * @param email MELCloud email
   * @param password MELCloud password
   * @returns Promise resolving to login success
   */
  async login(email: string, password: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}Login/ClientLogin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Email: email,
          Password: password,
          Language: 0,
          AppVersion: '1.23.4.0',
          Persist: true,
          CaptchaResponse: null,
        }),
      });

      const data = await response.json() as any;

      if (data.ErrorId !== null) {
        throw new Error(`MELCloud login failed: ${data.ErrorMessage}`);
      }

      this.contextKey = data.LoginData.ContextKey;
      return true;
    } catch (error) {
      console.error('MELCloud login error:', error);
      throw error;
    }
  }

  /**
   * Get devices from MELCloud
   * @returns Promise resolving to devices array
   */
  async getDevices(): Promise<any[]> {
    if (!this.contextKey) {
      throw new Error('Not logged in to MELCloud');
    }

    try {
      const response = await fetch(`${this.baseUrl}User/ListDevices`, {
        method: 'GET',
        headers: {
          'X-MitsContextKey': this.contextKey,
        },
      });

      const data = await response.json() as any[];
      this.devices = this.extractDevices(data);
      return this.devices;
    } catch (error) {
      console.error('MELCloud get devices error:', error);
      throw error;
    }
  }

  /**
   * Extract devices from MELCloud response
   * @param data MELCloud response data
   * @returns Array of devices
   */
  private extractDevices(data: any[]): any[] {
    const devices: any[] = [];

    // Process each building
    data.forEach(building => {
      if (building.Structure && building.Structure.Devices) {
        building.Structure.Devices.forEach((device: any) => {
          devices.push({
            id: device.DeviceID,
            name: device.DeviceName,
            buildingId: building.ID,
            type: 'heat_pump',
            data: device,
          });
        });
      }
    });

    return devices;
  }

  /**
   * Get device by ID
   * @param deviceId Device ID
   * @returns Device object or null if not found
   */
  getDeviceById(deviceId: string): any {
    return this.devices.find(device => device.id === deviceId) || null;
  }

  /**
   * Get device state
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @returns Promise resolving to device state
   */
  async getDeviceState(deviceId: string, buildingId: number): Promise<any> {
    if (!this.contextKey) {
      throw new Error('Not logged in to MELCloud');
    }

    try {
      const response = await fetch(`${this.baseUrl}Device/Get?id=${deviceId}&buildingID=${buildingId}`, {
        method: 'GET',
        headers: {
          'X-MitsContextKey': this.contextKey,
        },
      });

      return await response.json();
    } catch (error) {
      console.error(`MELCloud get device state error for device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Set device temperature
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @param temperature Target temperature
   * @returns Promise resolving to success
   */
  async setDeviceTemperature(deviceId: string, buildingId: number, temperature: number): Promise<boolean> {
    if (!this.contextKey) {
      throw new Error('Not logged in to MELCloud');
    }

    try {
      // First get current state
      const currentState = await this.getDeviceState(deviceId, buildingId);

      // Update temperature
      currentState.SetTemperature = temperature;

      // Send update
      const response = await fetch(`${this.baseUrl}Device/SetAta`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MitsContextKey': this.contextKey,
        },
        body: JSON.stringify(currentState),
      });

      const data = await response.json();
      return data !== null;
    } catch (error) {
      console.error(`MELCloud set temperature error for device ${deviceId}:`, error);
      throw error;
    }
  }
}
