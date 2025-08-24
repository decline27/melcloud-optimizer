/**
 * Helper class for calculating and tracking COP (Coefficient of Performance)
 * for MELCloud heat pumps
 */
class COPHelper {
  /**
   * Constructor
   * @param {Object} homey - Homey app instance
   * @param {Object} logger - Logger instance
   */
  constructor(homey, logger, services) {
    this.homey = homey;
    this.logger = logger;
    // Optional injected runtime services (preferred over globals)
    this.services = services || {};
    this.dailyJob = null;
    this.weeklyJob = null;
    this.monthlyJob = null;

    // Constants for storage keys
    this.COP_SNAPSHOTS_DAILY = 'cop_snapshots_daily';
    this.COP_SNAPSHOTS_WEEKLY = 'cop_snapshots_weekly';
    this.COP_SNAPSHOTS_MONTHLY = 'cop_snapshots_monthly';

    // Schedule jobs
    this.scheduleJobs();
  }



  /**
   * Schedule cron jobs for COP calculations
   */
  scheduleJobs() {
    try {
      // Import the cron library
      const { CronJob } = require('cron');

      // DAILY at 00:05
      this.dailyJob = new CronJob('0 5 0 * * *', async () => {
        this.logger.log('Daily COP calculation job triggered');
        await this.compute('daily');
      });

      // WEEKLY every Monday at 00:10
      this.weeklyJob = new CronJob('0 10 0 * * 1', async () => {
        this.logger.log('Weekly COP calculation job triggered');
        await this.compute('weekly');
      });

      // MONTHLY on the 1st at 00:15
      this.monthlyJob = new CronJob('0 15 0 1 * *', async () => {
        this.logger.log('Monthly COP calculation job triggered');
        await this.compute('monthly');
      });

      // Start the jobs
      this.dailyJob.start();
      this.weeklyJob.start();
      this.monthlyJob.start();

      this.logger.log('COP calculation jobs scheduled');
    } catch (error) {
      this.logger.error('Error scheduling COP calculation jobs:', error);
    }
  }

  /**
   * Compute COP for a specific timeframe
   * @param {string} timeframe - Timeframe for calculation (daily, weekly, monthly)
   */
  async compute(timeframe) {
    try {
      this.logger.log(`Computing ${timeframe} COP values`);

      // Get MELCloud data from the optimizer
      const melData = await this.getMELCloudData();
      if (!melData || !melData.Device) {
        this.logger.error('No MELCloud data available for COP calculation');
        return;
      }

      // Extract energy figures – values are kWh for the period up to now
      const producedHeating = melData.Device.DailyHeatingEnergyProduced || 0;
      const consumedHeating = melData.Device.DailyHeatingEnergyConsumed || 0;
      const producedHW = melData.Device.DailyHotWaterEnergyProduced || 0;
      const consumedHW = melData.Device.DailyHotWaterEnergyConsumed || 0;

      // Safety – avoid division by zero
      const copHeat = consumedHeating > 0 ? producedHeating / consumedHeating : 0;
      const copHW = consumedHW > 0 ? producedHW / consumedHW : 0;

      // Store a snapshot for later aggregation
      await this.pushSnapshot(timeframe, {
        heat: { produced: producedHeating, consumed: consumedHeating, cop: copHeat },
        water: { produced: producedHW, consumed: consumedHW, cop: copHW },
        timestamp: new Date().toISOString(),
      });

      // Log the values
      this.logger.log(`${timeframe.charAt(0).toUpperCase() + timeframe.slice(1)} COP values:`);
      this.logger.log(`- Heating: Produced ${producedHeating.toFixed(2)} kWh, Consumed ${consumedHeating.toFixed(2)} kWh, COP ${copHeat.toFixed(2)}`);
      this.logger.log(`- Hot Water: Produced ${producedHW.toFixed(2)} kWh, Consumed ${consumedHW.toFixed(2)} kWh, COP ${copHW.toFixed(2)}`);
    } catch (error) {
      this.logger.error(`Error computing ${timeframe} COP:`, error);
    }
  }

  /**
   * Get MELCloud data from the optimizer
   * @returns {Promise<Object>} MELCloud data
   */
  async getMELCloudData() {
    try {
      // Get the device ID and building ID from settings
      const deviceId = this.homey.settings.get('device_id');
      const buildingId = parseInt(this.homey.settings.get('building_id') || '0');

      if (!deviceId || !buildingId) {
        this.logger.error('Device ID or Building ID not set in settings');
        return null;
      }

      // Prefer an injected melCloud service; fall back to legacy global if
      // one hasn't been injected. Tests should inject services where
      // possible rather than mutating globals.
      const melCloud = this.services && this.services.melCloud ? this.services.melCloud : (global.melCloud);
      if (!melCloud) {
        this.logger.error('MELCloud API instance not available');
        return null;
      }

      // Get COP data from MELCloud
      const copData = await melCloud.getCOPData(deviceId, buildingId);
      return copData;
    } catch (error) {
      this.logger.error('Error getting MELCloud data for COP calculation:', error);
      return null;
    }
  }

  /**
   * Push a snapshot into device store
   * @param {string} key - Timeframe key (daily, weekly, monthly)
   * @param {Object} data - Snapshot data
   */
  async pushSnapshot(key, data) {
    try {
      const storeKey = `cop_snapshots_${key}`;
      const list = (await this.homey.settings.get(storeKey)) || [];
      list.push(data);

      // Keep only the latest 31 entries (≈ a month)
      if (list.length > 31) list.splice(0, list.length - 31);

      await this.homey.settings.set(storeKey, list);
      this.logger.log(`Saved ${key} COP snapshot (total: ${list.length})`);
    } catch (error) {
      this.logger.error(`Error saving ${key} COP snapshot:`, error);
    }
  }

  /**
   * Get the average COP for a specific timeframe
   * @param {string} timeframe - Timeframe for calculation (daily, weekly, monthly)
   * @param {string} type - Type of COP (heat or water)
   * @returns {Promise<number>} Average COP value
   */
  async getAverageCOP(timeframe, type) {
    try {
      const storeKey = `cop_snapshots_${timeframe}`;
      const snapshots = await this.homey.settings.get(storeKey) || [];

      if (snapshots.length === 0) {
        return 0;
      }

      // Calculate average COP
      let totalCOP = 0;
      let validEntries = 0;

      for (const snapshot of snapshots) {
        const cop = type === 'heat' ? snapshot.heat.cop : snapshot.water.cop;
        if (cop > 0) {
          totalCOP += cop;
          validEntries++;
        }
      }

      return validEntries > 0 ? totalCOP / validEntries : 0;
    } catch (error) {
      this.logger.error(`Error getting average ${timeframe} ${type} COP:`, error);
      return 0;
    }
  }

  /**
   * Get the latest COP values
   * @returns {Promise<Object>} Latest COP values for heating and hot water
   */
  async getLatestCOP() {
    try {
      const dailySnapshots = await this.homey.settings.get('cop_snapshots_daily') || [];

      if (dailySnapshots.length === 0) {
        return { heating: 0, hotWater: 0 };
      }

      const latest = dailySnapshots[dailySnapshots.length - 1];
      return {
        heating: latest.heat.cop || 0,
        hotWater: latest.water.cop || 0
      };
    } catch (error) {
      this.logger.error('Error getting latest COP values:', error);
      return { heating: 0, hotWater: 0 };
    }
  }

  /**
   * Check if it's summer season (for seasonal adjustments)
   * @returns {boolean} True if it's summer season
   */
  isSummerSeason() {
    const now = new Date();
    const month = now.getMonth(); // 0-11 (Jan-Dec)

    // Consider May through September as summer (months 4-8)
    return month >= 4 && month <= 8;
  }

  /**
   * Get the current season-appropriate COP value
   * @returns {Promise<number>} COP value based on season
   */
  async getSeasonalCOP() {
    const isSummer = this.isSummerSeason();

    if (isSummer) {
      // In summer, prioritize hot water COP
      return await this.getAverageCOP('daily', 'water');
    } else {
      // In winter, prioritize heating COP
      return await this.getAverageCOP('daily', 'heat');
    }
  }

  /**
   * Get COP data for the API
   * @returns {Promise<Object>} COP data for API response
   */
  async getCOPData() {
    try {
      const dailyHeating = await this.getAverageCOP('daily', 'heat');
      const weeklyHeating = await this.getAverageCOP('weekly', 'heat');
      const monthlyHeating = await this.getAverageCOP('monthly', 'heat');

      const dailyHotWater = await this.getAverageCOP('daily', 'water');
      const weeklyHotWater = await this.getAverageCOP('weekly', 'water');
      const monthlyHotWater = await this.getAverageCOP('monthly', 'water');

      const isSummer = this.isSummerSeason();
      const seasonalCOP = isSummer ? dailyHotWater : dailyHeating;

      // Get snapshots for trends
      const dailySnapshots = await this.homey.settings.get('cop_snapshots_daily') || [];
      const weeklySnapshots = await this.homey.settings.get('cop_snapshots_weekly') || [];

      return {
        heating: {
          daily: dailyHeating,
          weekly: weeklyHeating,
          monthly: monthlyHeating,
          snapshots: dailySnapshots.map(s => ({
            timestamp: s.timestamp,
            cop: s.heat.cop,
            produced: s.heat.produced,
            consumed: s.heat.consumed
          }))
        },
        hotWater: {
          daily: dailyHotWater,
          weekly: weeklyHotWater,
          monthly: monthlyHotWater,
          snapshots: dailySnapshots.map(s => ({
            timestamp: s.timestamp,
            cop: s.water.cop,
            produced: s.water.produced,
            consumed: s.water.consumed
          }))
        },
        seasonal: {
          isSummer,
          currentCOP: seasonalCOP
        },
        weeklyTrend: weeklySnapshots.map(s => ({
          timestamp: s.timestamp,
          heatingCOP: s.heat.cop,
          hotWaterCOP: s.water.cop
        }))
      };
    } catch (error) {
      this.logger.error('Error getting COP data for API:', error);
      return {
        error: error.message,
        heating: { daily: 0, weekly: 0, monthly: 0 },
        hotWater: { daily: 0, weekly: 0, monthly: 0 },
        seasonal: { isSummer: this.isSummerSeason(), currentCOP: 0 }
      };
    }
  }
}

module.exports = { COPHelper };
