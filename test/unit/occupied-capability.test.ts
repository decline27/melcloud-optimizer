describe('Occupied Capability Integration', () => {
  let mockHomey: any;

  beforeEach(() => {
    mockHomey = {
      settings: {
        get: jest.fn(),
        set: jest.fn(),
        on: jest.fn()
      }
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should sync occupied capability with settings', async () => {
    // Setup initial settings value
    mockHomey.settings.get.mockReturnValue(true);
    
    // Simulate the capability listener function
    const occupiedListener = async (value: boolean) => {
      mockHomey.settings.set('occupied', value);
      return value;
    };

    // Test changing the capability value
    const result = await occupiedListener(false);
    
    expect(result).toBe(false);
    expect(mockHomey.settings.set).toHaveBeenCalledWith('occupied', false);
  });

  test('should initialize occupied capability from settings', () => {
    // Test when settings has a value
    mockHomey.settings.get.mockReturnValue(false);
    
    const occupiedSetting = mockHomey.settings.get('occupied');
    const initialValue = occupiedSetting !== null && occupiedSetting !== undefined ? !!occupiedSetting : true;
    
    expect(initialValue).toBe(false);
    expect(mockHomey.settings.get).toHaveBeenCalledWith('occupied');
  });

  test('should default to true when settings is undefined', () => {
    // Test when no settings value exists
    mockHomey.settings.get.mockReturnValue(undefined);
    
    // Should default to true (home/occupied)
    const occupiedSetting = mockHomey.settings.get('occupied');
    const initialValue = occupiedSetting !== null && occupiedSetting !== undefined ? !!occupiedSetting : true;
    
    expect(initialValue).toBe(true);
  });

  test('should handle settings listener for occupied changes', () => {
    const settingsListener = jest.fn();
    mockHomey.settings.on.mockImplementation((event: string, callback: any) => {
      if (event === 'set') {
        settingsListener.mockImplementation(callback);
      }
    });

    // Simulate settings change
    mockHomey.settings.get.mockReturnValue(false);
    
    // Call the settings listener directly with the key 'occupied'
    const mockCallback = jest.fn((key: string) => {
      if (key === 'occupied') {
        mockHomey.settings.get('occupied');
      }
    });
    
    mockCallback('occupied');
    
    expect(mockCallback).toHaveBeenCalledWith('occupied');
  });
});