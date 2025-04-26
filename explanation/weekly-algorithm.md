The weekly calibration algorithm uses a thermal learning model to improve temperature optimization:

1. Data Collection:
   - Collects optimization data points (minimum 24 data points required)
   - Stores data persistently to survive app reinstallations
   - Includes temperature changes, price levels, and weather conditions

2. Thermal Model Analysis:
   - Analyzes relationship between temperature changes and price changes
   - Calculates average temperature change per price change
   - Considers outdoor temperature influence
   - Determines optimal K-factor (thermal responsiveness)
   - Adapts to your home's specific thermal characteristics

3. Model Update:
   - Updates thermal model K-factor based on observed data
   - K-factor influences how aggressively temperature changes with price
   - Higher K-factor = more aggressive temperature changes
   - Lower K-factor = more conservative temperature changes

4. Integration:
   - New K-factor immediately affects hourly optimization
   - Provides detailed analysis of model performance
   - Creates timeline entries with calibration results
   - Logs thermal model insights for future reference