# MELCloud Optimization Algorithm Simulator

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install commander
   ```

2. **Run the simulation:**
   ```bash
   node simulate.js --data data/timeseries.csv --config data/config.yaml --output results/
   ```

3. **View results:**
   - Console output shows summary metrics comparison
   - `results/baseline_decisions.csv` - Algorithm v1 decisions
   - `results/v2_decisions.csv` - Algorithm v2 decisions  
   - `results/metrics.json` - Detailed comparison metrics

## Example Output

```
🔄 Loading simulation data...
📊 Simulating 207 data points (17.2 hours)...

🎯 Simulation Results:

Baseline (Algorithm v1):
  Total Cost: 48.23 SEK
  Total Energy: 52.1 kWh
  Minutes Outside Comfort: 85 min
  Compressor Switches: 24
  Average COP: 2.5

Algorithm v2:
  Total Cost: 42.17 SEK (-12.6%)
  Total Energy: 47.8 kWh (-8.3%)
  Minutes Outside Comfort: 65 min (-23.5%)
  Compressor Switches: 18 (-25.0%)
  Average COP: 2.5

✨ Improvement Summary:
  ✅ Cost Reduction: 6.06 SEK (12.6%)
  ✅ Comfort: 20 fewer minutes outside band
  ✅ Equipment Protection: 6 fewer compressor cycles
```

## Algorithm Comparison

### Algorithm v1 (Current)
- Simple price percentile-based temperature adjustment
- Linear mapping from price to setpoint within comfort band
- No COP consideration or occupancy optimization

### Algorithm v2 (Proposed)
- Rule-based optimization with multiple strategies:
  - **Preheat**: Cheap electricity + good COP → increase setpoint
  - **Coast**: Expensive electricity + thermal buffer → reduce setpoint
  - **Comfort Recovery**: Temperature below comfort → priority heating
  - **Maintain**: Normal operation within comfort band
- Considers COP efficiency curves and occupancy patterns
- Dynamic comfort bands (occupied vs. away)

## Data Files

- `data/timeseries.csv` - 5-minute resolution time series with temperature, price, occupancy
- `data/cop_curve.csv` - COP efficiency curves by outdoor temp and delta
- `data/device_limits.csv` - Heat pump constraints and capabilities
- `data/config.yaml` - Comfort bands, weights, safety parameters

## Metrics Calculated

- **Total Cost**: Electricity cost in SEK
- **Total Energy**: Heat pump electrical consumption in kWh
- **Minutes Outside Comfort**: Time spent outside temperature comfort band
- **Compressor Switches**: Number of setpoint changes (equipment wear)
- **Average COP**: System efficiency coefficient of performance

## Integration with MELCloud App

The simulator uses the same optimization logic that would be implemented in the Homey app's `src/services/optimizer.ts`. Key integration points:

1. **Price Data**: Replace simulation CSV with live Tibber API data
2. **COP Curves**: Replace simulation CSV with MELCloud API device efficiency data  
3. **Temperature Readings**: Replace simulation data with Homey device sensors
4. **Setpoint Control**: Replace simulation output with MELCloud API calls

## Validation

The simulator validates the Algorithm v2 improvements before production deployment:

- **A/B Testing**: Compare algorithms on historical data
- **Sensitivity Analysis**: Test with different price volatility scenarios
- **Comfort Analysis**: Ensure temperature stays within acceptable bounds
- **Equipment Protection**: Minimize compressor cycling and wear

This simulation framework enables data-driven optimization development and provides confidence in algorithm changes before affecting real heat pump systems.