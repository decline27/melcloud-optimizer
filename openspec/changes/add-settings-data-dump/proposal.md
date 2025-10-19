# Data Dump Feature for Settings Page

## Why

Users need visibility into the thermal data, hot water usage patterns, COP snapshots, adaptive parameters, and other learned/stored data to understand system behavior, troubleshoot issues, and verify that the learning algorithms are working correctly. Currently, this data is stored in Homey's settings but not accessible to users in a human-readable format.

## What Changes

- Add a "Data Dump" button to the settings page
- Create API endpoint to collect all stored app data
- Display comprehensive data dump in HTML format within the settings page
- Include thermal model data, hot water patterns, COP snapshots, adaptive parameters, optimization history, and all configuration settings
- Format data with proper structure, timestamps, and units for easy analysis
- Implement data visualization/formatting for better readability

## Impact

- Affected specs: settings-ui (new capability)
- Affected code: 
  - `src/api.ts` - new data dump API method
  - `settings/index.html` - new button and display section
  - API layer to aggregate data from all services
  - HTML formatting utilities for data presentation
- No breaking changes - purely additive feature
- Helps with debugging, validation, and user transparency