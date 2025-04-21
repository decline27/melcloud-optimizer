// Mock for the Homey module
export class App {
  log = jest.fn();
  error = jest.fn();
  homey = {
    settings: {
      get: jest.fn(),
      set: jest.fn(),
      on: jest.fn(),
    },
    notifications: {
      createNotification: jest.fn().mockResolvedValue(undefined),
    },
    flow: {
      runFlowCardAction: jest.fn().mockResolvedValue(undefined),
    },
    setInterval: jest.fn(),
  };
}

// Export the App class as the default export
export default {
  App,
};
