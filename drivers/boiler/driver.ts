import Homey from 'homey';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { HomeyLogger, LogLevel } from '../../src/util/logger';

module.exports = class BoilerDriver extends Homey.Driver {
  private melCloudApi?: MelCloudApi;
  private logger!: HomeyLogger;

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.logger = new HomeyLogger(this.homey, {
      level: LogLevel.INFO,
      logToTimeline: false,
      prefix: 'BoilerDriver',
      includeTimestamps: true,
      includeSourceModule: true
    });

    this.logger.log('BoilerDriver has been initialized');

    // Initialize MELCloud API
    try {
      this.melCloudApi = new MelCloudApi(this.logger);
      this.logger.log('MELCloud API initialized for driver');
    } catch (error) {
      this.logger.error('Failed to initialize MELCloud API:', error);
    }
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    try {
      this.logger.log('Fetching MELCloud devices for pairing...');

      if (!this.melCloudApi) {
        throw new Error('MELCloud API not initialized');
      }

      // Check if we have credentials
      const email = this.homey.settings.get('melcloud_user');
      const password = this.homey.settings.get('melcloud_pass');

      if (!email || !password) {
        this.logger.error('MELCloud credentials not configured');
        throw new Error('MELCloud credentials not configured. Please configure them in the app settings first.');
      }

      // Set up global homeySettings for the API (temporary)
      if (!(global as any).homeySettings) {
        (global as any).homeySettings = this.homey.settings;
      }

      // Login and get devices
      await this.melCloudApi.login(email, password);
      const devices = await this.melCloudApi.getDevices();

      this.logger.log(`Found ${devices.length} MELCloud devices`);

      // Convert MELCloud devices to Homey device format
      const homeyDevices = devices.map(device => ({
        name: `${device.name} (Boiler)`,
        data: {
          id: `melcloud_boiler_${device.id}`,
          deviceId: String(device.id),
          buildingId: Number(device.buildingId)
        },
        store: {
          melcloud_device_id: String(device.id),
          melcloud_building_id: Number(device.buildingId),
          device_name: device.name
        },
        settings: {
          device_id: String(device.id),
          building_id: Number(device.buildingId)
        }
      }));

      return homeyDevices;
    } catch (error) {
      this.logger.error('Failed to fetch MELCloud devices:', error);
      throw error;
    }
  }

};
