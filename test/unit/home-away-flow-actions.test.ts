import HeatOptimizerApp from '../../src/app';

describe('Home/Away Flow Actions', () => {
  let app: HeatOptimizerApp;
  let mockHomey: any;
  let mockEntsoeActionCard: any;
  let currentSetOccupiedCard: any;

  beforeEach(() => {
    mockEntsoeActionCard = {
      registerRunListener: jest.fn()
    };
    currentSetOccupiedCard = null;

    mockHomey = {
      settings: {
        get: jest.fn().mockReturnValue(true),
        set: jest.fn(),
        on: jest.fn()
      },
      flow: {
        getActionCard: jest.fn((cardId: string) => {
          if (cardId === 'get_entsoe_prices') {
            return mockEntsoeActionCard;
          }
          if (cardId === 'set_occupied') {
            return currentSetOccupiedCard;
          }
          return undefined;
        })
      },
      log: jest.fn(),
      error: jest.fn()
    };

    app = new HeatOptimizerApp();
    (app as any).homey = mockHomey;
    (app as any).logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
    (app as any).timelineHelper = null; // Start without timeline helper
  });

  describe('set_occupied flow action', () => {
    it('should register flow action without errors', () => {
      currentSetOccupiedCard = {
        registerRunListener: jest.fn()
      };

      // Call the private method that registers flow actions
      (app as any).registerEntsoeFlowAction();

      expect(mockHomey.flow.getActionCard).toHaveBeenCalledWith('set_occupied');
      expect(currentSetOccupiedCard.registerRunListener).toHaveBeenCalled();
    });

    it('should handle occupied=true argument correctly', async () => {
      currentSetOccupiedCard = {
        registerRunListener: jest.fn()
      };
      (app as any).registerEntsoeFlowAction();

      // Get the registered listener
      const listener = currentSetOccupiedCard.registerRunListener.mock.calls[0][0];
      
      // Call with occupied=true
      const result = await listener({ occupied: 'true' });

      expect(mockHomey.settings.set).toHaveBeenCalledWith('occupied', true);
      expect(result).toBe(true);
    });

    it('should handle occupied=false argument correctly', async () => {
      currentSetOccupiedCard = {
        registerRunListener: jest.fn()
      };
      (app as any).registerEntsoeFlowAction();

      // Get the registered listener
      const listener = currentSetOccupiedCard.registerRunListener.mock.calls[0][0];
      
      // Call with occupied=false
      const result = await listener({ occupied: 'false' });

      expect(mockHomey.settings.set).toHaveBeenCalledWith('occupied', false);
      expect(result).toBe(true);
    });

    it('should add timeline entry when timeline helper is available', async () => {
      const mockTimelineHelper = {
        addTimelineEntry: jest.fn().mockResolvedValue(undefined)
      };
      (app as any).timelineHelper = mockTimelineHelper;

      currentSetOccupiedCard = {
        registerRunListener: jest.fn()
      };
      (app as any).registerEntsoeFlowAction();

      // Get the registered listener and call it
      const listener = currentSetOccupiedCard.registerRunListener.mock.calls[0][0];
      await listener({ occupied: 'true' });

      expect(mockTimelineHelper.addTimelineEntry).toHaveBeenCalled();
    });

    it('should handle missing flow manager gracefully', () => {
      mockHomey.flow = undefined;

      expect(() => {
        (app as any).registerEntsoeFlowAction();
      }).not.toThrow();
    });
  });
});
