import HeatOptimizerApp from './app';

/**
 * API class for the MELCloud Optimizer app
 * This class handles all API requests from the settings page
 */
export class Api {
  private app: HeatOptimizerApp;

  constructor(app: HeatOptimizerApp) {
    this.app = app;
  }

  /**
   * Run test logging
   */
  async testLogging() {
    this.app.log('API method testLogging called');
    this.app.testLogging();
    return { success: true, message: 'Test logging completed' };
  }

  /**
   * Run hourly optimizer
   */
  async runHourlyOptimizer() {
    this.app.log('API method runHourlyOptimizer called');
    await this.app.runHourlyOptimizer();
    return { success: true, message: 'Hourly optimization completed' };
  }

  /**
   * Run weekly calibration
   */
  async runWeeklyCalibration() {
    this.app.log('API method runWeeklyCalibration called');
    await this.app.runWeeklyCalibration();
    return { success: true, message: 'Weekly calibration completed' };
  }
}
