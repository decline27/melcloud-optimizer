console.log('Testing if our changes made it into the build...');

// Let's check the driver file content
const fs = require('fs');
const path = require('path');

try {
    // Check if our driver changes are present
    const driverPath = path.join(__dirname, 'drivers', 'boiler', 'driver.js');
    if (fs.existsSync(driverPath)) {
        const content = fs.readFileSync(driverPath, 'utf8');
        if (content.includes('missingSettings')) {
            console.log('✅ Driver changes found - enhanced validation is present');
        } else {
            console.log('❌ Driver changes not found - old validation logic');
        }
    }

    // Check if our API changes are present
    const apiPath = path.join(__dirname, 'api.js');
    if (fs.existsSync(apiPath)) {
        const content = fs.readFileSync(apiPath, 'utf8');
        if (content.includes('validateAndStartCron')) {
            console.log('✅ API changes found - validateAndStartCron endpoint is present');
        } else {
            console.log('❌ API changes not found - endpoint missing');
        }
    }

    // Check app.json
    const appJsonPath = path.join(__dirname, 'app.json');
    if (fs.existsSync(appJsonPath)) {
        const content = fs.readFileSync(appJsonPath, 'utf8');
        const appJson = JSON.parse(content);
        if (appJson.api && appJson.api.validateAndStartCron) {
            console.log('✅ app.json updated - validateAndStartCron endpoint declared');
        } else {
            console.log('❌ app.json not updated - endpoint not declared');
        }
    }

} catch (error) {
    console.error('Error checking files:', error);
}