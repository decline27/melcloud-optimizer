import HeatOptimizerApp from '../../src/app';

describe('Home/Away Flow Actions', () => {
  let app: HeatOptimizerApp;
  let mockHomey: any;

  beforeEach(() => {
    mockHomey = {
      settings: {
        get: jest.fn().mockReturnValue(true),
        set: jest.fn(),
        on: jest.fn()
      },
      flow: {
        getActionCard: jest.fn()
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
      const mockActionCard = {
        registerRunListener: jest.fn()
      };
      
      mockHomey.flow.getActionCard.mockReturnValue(mockActionCard);

      // Call the private method that registers flow actions
      (app as any).registerFlowActions();

      expect(mockHomey.flow.getActionCard).toHaveBeenCalledWith('set_occupied');
      expect(mockActionCard.registerRunListener).toHaveBeenCalled();
    });

    it('should handle occupied=true argument correctly', async () => {
      const mockActionCard = {
        registerRunListener: jest.fn()
      };
      
      mockHomey.flow.getActionCard.mockReturnValue(mockActionCard);
      (app as any).registerFlowActions();

      // Get the registered listener
      const listener = mockActionCard.registerRunListener.mock.calls[0][0];
      
      // Call with occupied=true
      const result = await listener({ occupied: 'true' });

      expect(mockHomey.settings.set).toHaveBeenCalledWith('occupied', true);
      expect(result).toBe(true);
    });

    it('should handle occupied=false argument correctly', async () => {
      const mockActionCard = {
        registerRunListener: jest.fn()
      };
      
      mockHomey.flow.getActionCard.mockReturnValue(mockActionCard);
      (app as any).registerFlowActions();

      // Get the registered listener
      const listener = mockActionCard.registerRunListener.mock.calls[0][0];
      
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

      const mockActionCard = {
        registerRunListener: jest.fn()
      };
      
      mockHomey.flow.getActionCard.mockReturnValue(mockActionCard);
      (app as any).registerFlowActions();

      // Get the registered listener and call it
      const listener = mockActionCard.registerRunListener.mock.calls[0][0];
      await listener({ occupied: 'true' });

      expect(mockTimelineHelper.addTimelineEntry).toHaveBeenCalled();
    });

    it('should handle missing flow manager gracefully', () => {
      mockHomey.flow = undefined;

      expect(() => {
        (app as any).registerFlowActions();
      }).not.toThrow();
    });
  });
});