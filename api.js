module.exports = function(app) {
  console.log('API module: Creating API instance with app:', !!app);
  console.log('API module: App has homey:', !!app?.homey);
  console.log('API module: App has log:', typeof app?.log);
  
  const { Api } = require('./src/api');
  const apiInstance = new Api(app);
  
  console.log('API module: API instance created');
  console.log('API module: API instance has getDeviceList:', typeof apiInstance.getDeviceList);
  
  return apiInstance;
};