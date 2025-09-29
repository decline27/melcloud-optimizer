#!/usr/bin/env node

/**
 * Test script to manually trigger hot water pattern learning
 * This script will force data collection and pattern analysis to test the improvements
 */

const { spawn } = require('child_process');
const readline = require('readline');

// Setup readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🔥 MELCloud Hot Water Pattern Testing Tool');
console.log('==========================================');
console.log('');
console.log('This script will help you test the hot water usage pattern learning.');
console.log('');

async function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function runTest() {
  try {
    console.log('📋 Test Options:');
    console.log('1. View current patterns');
    console.log('2. Run manual optimization (triggers data collection)');
    console.log('3. Clear existing patterns and restart learning');
    console.log('4. Exit');
    console.log('');
    
    const choice = await question('Select an option (1-4): ');
    
    switch (choice.trim()) {
      case '1':
        await viewCurrentPatterns();
        break;
      case '2':
        await runManualOptimization();
        break;
      case '3':
        await clearPatterns();
        break;
      case '4':
        console.log('Goodbye! 👋');
        process.exit(0);
      default:
        console.log('Invalid choice. Please select 1-4.');
        break;
    }
    
    console.log('');
    await runTest(); // Loop back to menu
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

async function viewCurrentPatterns() {
  console.log('');
  console.log('📊 Viewing current hot water usage patterns...');
  console.log('');
  
  try {
    // This will call the API to get patterns
    const curl = spawn('curl', [
      '-s',
      'http://localhost:8080/api/app/com.melcloud.optimize/getHotWaterPatterns'
    ]);
    
    let output = '';
    curl.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    curl.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(output);
          if (result.success) {
            console.log('✅ Pattern data retrieved successfully');
            console.log('Check the Homey app logs for detailed pattern information');
          } else {
            console.log('⚠️  No patterns found yet or error occurred');
            console.log('Message:', result.message || 'Unknown error');
          }
        } catch (parseError) {
          console.log('❌ Failed to parse API response');
          console.log('Raw output:', output);
        }
      } else {
        console.log('❌ Failed to connect to Homey app (is it running?)');
      }
    });
    
    curl.on('error', (error) => {
      console.log('❌ Error calling API:', error.message);
      console.log('💡 Make sure the Homey app is running with "homey app run"');
    });
    
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

async function runManualOptimization() {
  console.log('');
  console.log('🔄 Running manual optimization (this will collect hot water data)...');
  console.log('');
  
  try {
    const curl = spawn('curl', [
      '-s',
      'http://localhost:8080/api/app/com.melcloud.optimize/runHourlyOptimizer'
    ]);
    
    let output = '';
    curl.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    curl.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(output);
          if (result.success) {
            console.log('✅ Manual optimization completed successfully');
            console.log('🔥 Hot water data has been collected');
            console.log('📊 Check the logs to see data collection progress');
          } else {
            console.log('⚠️  Optimization completed with warnings');
            console.log('Message:', result.message || 'Check logs for details');
          }
        } catch (parseError) {
          console.log('❌ Failed to parse API response');
          console.log('Raw output:', output);
        }
      } else {
        console.log('❌ Failed to connect to Homey app (is it running?)');
      }
    });
    
    curl.on('error', (error) => {
      console.log('❌ Error calling API:', error.message);
      console.log('💡 Make sure the Homey app is running with "homey app run"');
    });
    
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

async function clearPatterns() {
  console.log('');
  console.log('🗑️  This will clear all existing hot water patterns and restart learning.');
  const confirm = await question('Are you sure? (y/N): ');
  
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    return;
  }
  
  console.log('🧹 Clearing patterns... (Note: This feature needs to be implemented in the API)');
  console.log('For now, you can restart the Homey app to reset patterns.');
}

// Start the test tool
console.log('Starting hot water pattern test tool...');
runTest().finally(() => {
  rl.close();
});