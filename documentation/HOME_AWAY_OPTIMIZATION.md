# Home/Away Optimization Guide

The MELCloud Optimizer now supports **home/away scenarios** that automatically adjust comfort settings and optimization strategies based on whether you're home or away.

## Overview

The system uses different **comfort bands** for occupied (home) and away modes:
- **Home (Occupied)**: More comfortable temperature range with conservative optimization
- **Away**: Energy-saving temperature range with more aggressive optimization

## Default Configuration

### Home (Occupied) Mode
- **Lower bound**: 20.0°C - Minimum comfortable temperature when home
- **Upper bound**: 21.0°C - Maximum temperature for preheating when electricity is cheap
- **Strategy**: Balanced comfort and savings

### Away Mode  
- **Lower bound**: 19.0°C - Minimum safe temperature (building protection)
- **Upper bound**: 20.5°C - Maximum temperature when away
- **Strategy**: Aggressive energy savings

## Configuration

### Via Settings UI

1. Open the MELCloud Optimizer app settings
2. Navigate to **Comfort & Stability** section
3. Configure your comfort bands:
   - **Occupied Lower/Upper**: Your preferred temperature range when home
   - **Away Lower/Upper**: Energy-saving temperature range when away
4. Toggle **"Home is occupied"** checkbox to manually switch modes

### Via Flow Actions (Automation)

Create flows to automatically switch between home and away modes:

#### Example Flows

**Flow 1: Away when leaving home**
```
WHEN: Someone left home (using presence detection)
THEN: Set home/away state to "Away"
```

**Flow 2: Home when arriving**
```
WHEN: Someone came home
THEN: Set home/away state to "Home (Occupied)"
```

**Flow 3: Time-based automation**
```
WHEN: Time is 08:00 on weekdays
THEN: Set home/away state to "Away"

WHEN: Time is 17:00 on weekdays  
THEN: Set home/away state to "Home (Occupied)"
```

## How It Works

### Temperature Targeting

The optimizer automatically selects the appropriate comfort band based on occupancy:

**During Expensive Electricity Periods:**
- **Home mode**: Maintains comfortable temperatures (20-23°C range)
- **Away mode**: Allows lower temperatures (19-21°C range) to save money

**During Cheap Electricity Periods:**
- **Home mode**: Preheats within comfort range for later savings
- **Away mode**: Limited preheating to stay within narrower away band

### Optimization Strategies

**Home (Occupied) Mode:**
- Conservative temperature adjustments
- Prioritizes comfort over maximum savings
- Uses full occupied comfort band (typically 3°C range)

**Away Mode:**
- More aggressive energy optimization
- Accepts reduced comfort for higher savings  
- Uses narrower away comfort band (typically 2°C range)
- Maintains minimum safe temperatures for building protection

## Integration Examples

### With Presence Detection

```javascript
// Homey Flow Card
// WHEN: Variable 'occupancy' changed
// THEN: Set home/away state to [[occupancy_state]]
```

### With Calendar/Schedule

```javascript
// Morning departure (weekdays)
// WHEN: Time is 08:00 AND day is Monday, Tuesday, Wednesday, Thursday, Friday
// THEN: Set home/away state to "Away"

// Evening return
// WHEN: Time is 17:30 AND day is Monday, Tuesday, Wednesday, Thursday, Friday  
// THEN: Set home/away state to "Home (Occupied)"
```

### With Geofencing

```javascript
// WHEN: Distance to home is greater than 1km
// THEN: Set home/away state to "Away"

// WHEN: Distance to home is less than 0.5km
// THEN: Set home/away state to "Home (Occupied)"
```

## Benefits

### Energy Savings
- **Away mode**: 10-25% additional savings by accepting lower temperatures
- **Smart preheating**: Uses cheap electricity when home, minimal when away
- **Reduced cycling**: Optimized temperature bands reduce heat pump cycling

### Comfort
- **Automatic adjustment**: No manual temperature changes needed
- **Presence-aware**: Always comfortable when home
- **Quick recovery**: Fast heating when returning home during cheap periods

### Safety
- **Building protection**: Maintains minimum safe temperatures
- **Frost prevention**: Never drops below safe building limits
- **Gradual transitions**: Smooth temperature changes

## Troubleshooting

### Timeline Monitoring
Check the Homey timeline for optimization decisions:
- "🏠 Home/Away Mode Changed" entries when switching
- Hourly optimization logs showing which comfort band is active
- Temperature adjustment explanations

### Settings Validation
The system validates all comfort settings:
- Lower bounds must be less than upper bounds
- All temperatures within safe limits (16-26°C)
- Minimum 0.5°C difference between bounds

### Common Issues

**Issue**: "Away mode not saving energy"
**Solution**: Check that away comfort band is lower than occupied band

**Issue**: "Temperature too low when away"
**Solution**: Increase away lower bound in settings

**Issue**: "Not switching modes automatically"  
**Solution**: Verify flow actions are triggering correctly and check timeline

## Advanced Configuration

### Fine-tuning Comfort Bands

**Conservative Setup (Prioritize Comfort):**
- Occupied: 20.5°C - 22.0°C  
- Away: 19.5°C - 21.0°C

**Aggressive Savings Setup:**
- Occupied: 19.0°C - 21.5°C
- Away: 18.0°C - 19.5°C

### Seasonal Adjustments

Consider different settings for winter vs summer:
- **Winter**: Wider bands for more preheating opportunities
- **Summer**: Narrower bands focused on hot water optimization

The home/away optimization works seamlessly with all other optimizer features including COP tracking, weather awareness, and thermal modeling for maximum efficiency and comfort.