System Integration and Interaction:

1. Continuous Learning Loop:
   - Hourly algorithm uses K and S factors from weekly calibration
   - Stores detailed performance data
   - Weekly calibration analyzes this data to improve parameters
   - Creates self-improving optimization cycle

2. Key Parameters:
   - K-factor: Thermal response coefficient (typically 0.3-0.7)
   - S-factor: Seasonal adjustment (typically 0.1-0.3)
   - Temperature bounds: 18-22°C (configurable)
   - Price sensitivity: 5 levels (VERY_CHEAP to VERY_EXPENSIVE)
   - Weather adjustment: Based on temperature, wind, and cloud cover

3. MELCloud API Integration:
   - Uses specific effective flags for different temperature controls:
     * Zone1 temperature: 0x200000080 (8589934720)
     * Zone2 temperature: 0x800000200 (34359738880)
     * Tank temperature: 0x1000000000020 (17592186044448)
   - Supports automatic device discovery
   - Handles multiple temperature zones if supported by the device
   - Supports hot water tank temperature control

4. Implemented Improvements:
   - Weather forecast integration via Met.no API
   - Time-of-day comfort profiles with day/night settings
   - Multi-zone optimization (Zone1, Zone2, tank)
   - Predictive pre-heating/cooling based on price forecasts

5. Potential Future Improvements:
   - Implement occupancy-based adjustments
   - Add machine learning for pattern recognition
   - Add integration with other smart home systems