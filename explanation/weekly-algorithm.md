The weekly calibration algorithm uses AI to improve the thermal model:

1. Data Analysis:
   - Collects past week's optimization data (168 hourly records)
   - Includes temperature changes, price levels, and actual outcomes

2. AI Processing (via OpenAI):
   - Analyzes effectiveness of temperature adjustments
   - Evaluates energy savings vs comfort impact
   - Considers outdoor temperature influence
   - Determines optimal K-factor (thermal responsiveness)
   - Optionally adjusts S-factor (seasonal adjustment)

3. Model Update:
   - Updates thermal model parameters (K and S values)
   - K-factor influences how aggressively temperature changes with price
   - S-factor adjusts for seasonal effectiveness

4. Integration:
   - New parameters immediately affect hourly optimization
   - Provides analysis of model performance
   - Logs AI insights for future reference