// Simple test to verify the API endpoints are available
const fs = require('fs');
const path = require('path');

// Check that the API file exports the expected endpoints
try {
  // Load the compiled API file
  const api = require('./api.js');
  
  console.log('Testing API endpoints...');
  
  // Check if the hot water endpoints exist
  const hasResetPatterns = typeof api.postHotWaterResetPatterns === 'function';
  const hasClearData = typeof api.postHotWaterClearData === 'function';
  
  console.log('postHotWaterResetPatterns endpoint exists:', hasResetPatterns);
  console.log('postHotWaterClearData endpoint exists:', hasClearData);
  
  if (hasResetPatterns && hasClearData) {
    console.log('✓ All hot water API endpoints are properly defined!');
    process.exit(0);
  } else {
    console.log('✗ Some hot water API endpoints are missing');
    process.exit(1);
  }
  
} catch (error) {
  console.error('Error testing API endpoints:', error.message);
  process.exit(1);
}