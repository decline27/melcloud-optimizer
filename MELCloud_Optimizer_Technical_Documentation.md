# MELCloud Optimizer: Technical Documentation

## Overview

The MELCloud Optimizer is an advanced system designed to optimize the operation of Mitsubishi Electric heat pumps through the MELCloud platform. It intelligently adjusts temperature settings based on electricity prices, weather conditions, and the thermal characteristics of the building to maximize energy efficiency while maintaining comfort.

## Core Functionality

The system integrates with multiple data sources to make intelligent decisions:

1. **MELCloud API**: Retrieves heat pump data and controls temperature settings
2. **Tibber API**: Provides current and forecasted electricity prices
3. **Weather API**: Supplies weather data to factor into thermal calculations
4. **Thermal Learning Model**: Analyzes and predicts building thermal behavior

## Optimization Algorithm

### Hourly Optimization

The hourly optimization algorithm is the core of the system, running every hour to adjust heat pump settings based on current conditions:

#### Data Collection Phase
- Retrieves current device state from MELCloud (indoor/outdoor temperatures, target temperatures)
- Fetches electricity prices from Tibber (current, average, min, max)
- Obtains weather data (temperature, wind speed, humidity, cloud cover)
- Considers time of day for comfort profile adjustments

#### Temperature Calculation
The system uses two approaches to calculate optimal temperature:

1. **Advanced Thermal Model** (when sufficient data is available):
   - Analyzes the thermal characteristics of the building
   - Considers thermal inertia (how long the house retains heat)
   - Identifies upcoming expensive/cheap electricity periods
   - Makes strategic decisions like pre-heating during cheap periods
   - Provides detailed explanations for temperature adjustments

2. **Basic Optimization** (fallback method):
   - Normalizes electricity price between 0 and 1: `(currentPrice - minPrice) / (maxPrice - minPrice)`
   - Inverts normalized price (lower price = higher temperature)
   - Calculates target temperature: `midTemp + (invertedPrice - 0.5) * tempRange`
   - Applies constraints based on user settings (min/max temperatures)

#### Decision Implementation
- Applies temperature constraints (min/max temperatures)
- Limits temperature changes to configured step size
- Rounds to nearest supported increment (MELCloud supports 0.5°C increments)
- Calculates estimated savings and comfort impact
- Sets new temperature via MELCloud API if different from current
- Logs detailed information about the decision

### Weekly Calibration

The weekly calibration algorithm refines the thermal model based on collected data:

1. **Data Analysis**:
   - Analyzes collected thermal data points (minimum 24 required)
   - Calculates relationships between temperature changes and heating/cooling rates
   - Determines optimal K-factor (thermal responsiveness)
   - Adapts to the specific thermal characteristics of the building

2. **Model Update**:
   - Updates thermal model parameters based on observed data
   - Adjusts K-factor to influence how aggressively temperature changes with price
   - Higher K-factor = more aggressive temperature changes
   - Lower K-factor = more conservative temperature changes

## Thermal Learning Model

The thermal learning model is a sophisticated component that learns and predicts the thermal behavior of the building:

### Data Collection
- Collects data points at regular intervals (every 10 minutes)
- Stores indoor/outdoor temperatures, target temperature, heating status
- Includes weather conditions (wind speed, humidity, cloud cover)
- Persists data across app reinstalls (up to 2 weeks of history)

### Thermal Analysis
The thermal analyzer processes collected data to extract key thermal characteristics:

1. **Heating Rate**: How quickly the building warms up when heating is active
2. **Cooling Rate**: How quickly the building cools down when heating is off
3. **Thermal Mass**: The building's capacity to store thermal energy
4. **Weather Impact**: How external conditions affect internal temperature

### Temperature Prediction
The model can predict future indoor temperatures based on:
- Current indoor temperature
- Target temperature
- Outdoor temperature
- Heating system status
- Weather conditions
- Time period

### Optimization Recommendations
Based on thermal characteristics and price forecasts, the model provides recommendations:
- Pre-heating during cheap electricity periods before expensive ones
- Reducing temperature during expensive periods when comfort impact is minimal
- Calculating optimal start times to reach target temperatures
- Estimating energy and cost savings from optimization decisions

## Weather Integration

Weather data significantly impacts thermal behavior and optimization decisions:

1. **Data Collection**:
   - Uses Met.no API for weather forecasts
   - Retrieves temperature, humidity, wind speed, cloud cover, precipitation
   - Caches forecasts to reduce API calls

2. **Weather Impact Analysis**:
   - Calculates weather-based temperature adjustments
   - Considers wind speed for heat loss calculations
   - Factors in cloud cover for solar gain estimation
   - Provides weather trend analysis for upcoming periods

## Price Optimization Strategy

The system employs several strategies to optimize for electricity prices:

1. **Price-Based Temperature Modulation**:
   - Increases temperature during low-price periods
   - Decreases temperature during high-price periods
   - Balances price optimization with comfort preferences

2. **Thermal Storage Utilization**:
   - Uses the building's thermal mass as energy storage
   - Pre-heats during cheap electricity periods
   - Coasts through expensive periods using stored heat

3. **Predictive Optimization**:
   - Analyzes upcoming price trends
   - Plans temperature adjustments in advance
   - Optimizes heating schedules based on price forecasts

## Comfort Balancing

While optimizing for cost, the system maintains comfort through several mechanisms:

1. **Comfort Profiles**:
   - Considers time of day (day/night preferences)
   - Allows for temperature reduction during sleeping hours
   - Ensures comfortable temperatures during active hours

2. **Comfort Impact Assessment**:
   - Calculates comfort impact of temperature changes
   - Uses deviation from ideal temperature (21°C) as comfort metric
   - Balances energy savings with comfort preservation

3. **Constraint Application**:
   - Enforces user-defined minimum and maximum temperatures
   - Limits temperature change rate to avoid discomfort
   - Provides explanations for temperature decisions

## Data Persistence

The system ensures data persistence across app updates and reinstalls:

1. **Settings Storage**:
   - Stores thermal model data in Homey settings
   - Persists optimization parameters and user preferences
   - Maintains thermal learning across app updates

2. **Backup Mechanism**:
   - Creates backup files for thermal data
   - Provides fallback storage if settings are unavailable
   - Ensures continuous learning and optimization

## API Integration

### MELCloud API Integration

The system communicates with Mitsubishi Electric heat pumps through the MELCloud API:

1. **Authentication**:
   - Securely logs in using user credentials
   - Maintains session context for API calls

2. **Device Management**:
   - Retrieves available devices from user account
   - Stores device and building IDs for API calls

3. **State Monitoring**:
   - Fetches current device state (temperatures, operation mode)
   - Monitors energy usage and performance metrics

4. **Control Operations**:
   - Sets target temperatures based on optimization decisions
   - Adjusts operation parameters as needed

### Tibber API Integration

The system retrieves electricity pricing data through the Tibber API:

1. **Price Retrieval**:
   - Fetches current electricity price
   - Retrieves price forecasts for today and tomorrow
   - Calculates price statistics (average, minimum, maximum)

2. **Price Level Analysis**:
   - Determines price levels (VERY_CHEAP, CHEAP, NORMAL, EXPENSIVE, VERY_EXPENSIVE)
   - Uses price levels for optimization decisions
   - Provides price trend analysis

## Savings Calculation

The system estimates savings from optimization decisions:

1. **Energy Savings Estimation**:
   - Uses a model where each degree lower saves approximately 5% energy
   - Calculates energy saving percentage based on temperature difference
   - Factors in thermal characteristics for more accurate estimates

2. **Monetary Savings Calculation**:
   - Converts energy savings to monetary value
   - Uses current electricity price for calculations
   - Provides estimated savings for each optimization decision

## User Interface and Reporting

The system provides detailed information through various interfaces:

1. **Timeline Entries**:
   - Creates detailed timeline entries with optimization results
   - Shows temperature changes and reasons
   - Displays estimated savings and comfort impact

2. **Logs and Notifications**:
   - Logs detailed information about optimization decisions
   - Provides notifications for significant events
   - Explains the reasoning behind temperature changes

## Conclusion

The MELCloud Optimizer represents a sophisticated approach to heat pump management, balancing energy efficiency, cost savings, and comfort. By leveraging real-time data from multiple sources and employing advanced thermal modeling, the system continuously learns and adapts to provide optimal performance in varying conditions.

The combination of price-based optimization, thermal learning, and weather integration allows the system to make intelligent decisions that maximize savings while maintaining comfort, demonstrating the potential of smart home technology to enhance energy efficiency and reduce costs.
