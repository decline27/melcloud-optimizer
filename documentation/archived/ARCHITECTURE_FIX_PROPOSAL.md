This document has been archived and moved to `documentation/archived/ARCHITECTURE_FIX_PROPOSAL.md`.
Please refer to that file for the full proposal and implementation details.
```

**Benefits**:
- ✅ **Single source of truth** for configuration logic
- ✅ **Comprehensive validation** with helpful error messages
- ✅ **User override tracking** for debugging
- ✅ **Graceful degradation** when user settings are invalid

---

### **PR #2: Optimizer Integration Cleanup**
**Priority**: High | **Effort**: 1-2 hours | **Risk**: Low

#### **Objective**
Refactor the optimizer service to use the centralized configuration system, removing duplicate logic.

#### **Files to Modify**
- `src/services/optimizer.ts` (lines 1770-1810)

#### **Implementation**

**Replace the manual configuration building:**

```typescript
// BEFORE (lines 1770-1810 in optimizer.ts):
const engineCfg = {
  ...DefaultEngineConfig,
  comfortOccupied: {
    lowerC: Number.isFinite(comfortLowerOcc) ? comfortLowerOcc : DefaultEngineConfig.comfortOccupied.lowerC,
    upperC: Number.isFinite(comfortUpperOcc) ? comfortUpperOcc : DefaultEngineConfig.comfortOccupied.upperC,
  },
  // ... 25+ lines of manual merging
} as typeof DefaultEngineConfig;

// AFTER:
import { buildEngineConfig } from '../util/config-merger';

// Replace the entire configuration building block with:
const engineCfg = this.buildEngineConfig();

// Add this method to the Optimizer class:
private buildEngineConfig(): EngineConfig {
  if (!this.homey) {
    return DefaultEngineConfig; // Fallback for tests
  }
  
  const result = mergeUserSettingsWithDefaults(this.homey);
  
  // Log configuration warnings for user awareness
  if (result.warnings.length > 0) {
    this.homey.app.warn('Configuration issues detected:');
    result.warnings.forEach(warning => {
      this.homey.app.warn(`- ${warning.field}: ${warning.message}`);
    });
  }
  
  // Log user overrides for transparency
  if (Object.keys(result.userOverrides).length > 0) {
    this.homey.app.log('User settings applied:', result.userOverrides);
  }
  
  return result.config;
}
```

**Benefits**:
- ✅ **50+ lines removed** from optimizer (cleaner code)
- ✅ **Centralized logic** reduces bugs
- ✅ **Better error reporting** to users
- ✅ **Easier testing** and maintenance

---

### **PR #3: Settings UI Validation**
**Priority**: Medium | **Effort**: 2-3 hours | **Risk**: Low

#### **Objective**
Add real-time validation and feedback to the settings UI to prevent invalid configurations.

#### **Files to Modify**
- `settings/index.html` (JavaScript section)

#### **Implementation**

**Add validation functions to the settings UI:**

```javascript
// Add to settings/index.html JavaScript section:

/**
 * Validate comfort band settings
 */
function validateComfortBands() {
  const comfortLowerOcc = parseFloat(document.getElementById('comfort_lower_occupied').value);
  const comfortUpperOcc = parseFloat(document.getElementById('comfort_upper_occupied').value);
  const comfortLowerAway = parseFloat(document.getElementById('comfort_lower_away').value);
  const comfortUpperAway = parseFloat(document.getElementById('comfort_upper_away').value);
  
  const errors = [];
  const warnings = [];
  
  // Occupied band validation
  if (comfortLowerOcc >= comfortUpperOcc) {
    errors.push(`Occupied comfort: Lower (${comfortLowerOcc}°C) must be less than upper (${comfortUpperOcc}°C)`);
  } else if (comfortUpperOcc - comfortLowerOcc < 0.5) {
    warnings.push(`Occupied comfort: Consider at least 0.5°C spread for effective optimization (current: ${(comfortUpperOcc - comfortLowerOcc).toFixed(1)}°C)`);
  }
  
  // Away band validation
  if (comfortLowerAway >= comfortUpperAway) {
    errors.push(`Away comfort: Lower (${comfortLowerAway}°C) must be less than upper (${comfortUpperAway}°C)`);
  }
  
  // Cross-validation
  if (comfortUpperOcc > 24) {
    warnings.push(`Occupied upper ${comfortUpperOcc}°C is quite high - may increase energy usage`);
  }
  
  if (comfortLowerAway < 17) {
    warnings.push(`Away lower ${comfortLowerAway}°C is quite low - ensure comfort when returning home`);
  }
  
  return { errors, warnings, isValid: errors.length === 0 };
}

/**
 * Show validation feedback to user
 */
function showValidationFeedback(validation) {
  // Remove existing feedback
  const existingFeedback = document.querySelectorAll('.validation-feedback');
  existingFeedback.forEach(el => el.remove());
  
  // Add error messages
  if (validation.errors.length > 0) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'validation-feedback validation-error';
    errorDiv.style.cssText = 'color: #d32f2f; background: #ffebee; padding: 8px; border-radius: 4px; margin: 10px 0;';
    errorDiv.innerHTML = `
      <strong>⚠️ Configuration Errors:</strong>
      <ul>${validation.errors.map(error => `<li>${error}</li>`).join('')}</ul>
    `;
    document.querySelector('.homey-form-group').appendChild(errorDiv);
  }
  
  // Add warning messages
  if (validation.warnings.length > 0) {
    const warningDiv = document.createElement('div');
    warningDiv.className = 'validation-feedback validation-warning';
    warningDiv.style.cssText = 'color: #f57c00; background: #fff3e0; padding: 8px; border-radius: 4px; margin: 10px 0;';
    warningDiv.innerHTML = `
      <strong>💡 Recommendations:</strong>
      <ul>${validation.warnings.map(warning => `<li>${warning}</li>`).join('')}</ul>
    `;
    document.querySelector('.homey-form-group').appendChild(warningDiv);
  }
}

/**
 * Live validation on input change
 */
function setupLiveValidation() {
  const comfortInputs = [
    'comfort_lower_occupied',
    'comfort_upper_occupied', 
    'comfort_lower_away',
    'comfort_upper_away'
  ];
  
  comfortInputs.forEach(inputId => {
    const input = document.getElementById(inputId);
    if (input) {
      input.addEventListener('input', () => {
        setTimeout(() => { // Debounce validation
          const validation = validateComfortBands();
          showValidationFeedback(validation);
        }, 300);
      });
    }
  });
}

// Initialize validation when page loads
document.addEventListener('DOMContentLoaded', () => {
  setupLiveValidation();
  
  // Initial validation
  setTimeout(() => {
    const validation = validateComfortBands();
    showValidationFeedback(validation);
  }, 1000);
});

// Enhanced save function with validation
function saveSettingsWithValidation() {
  const validation = validateComfortBands();
  
  if (!validation.isValid) {
    Homey.alert('Please fix configuration errors before saving.');
    return false;
  }
  
  if (validation.warnings.length > 0) {
    const confirmMsg = `Save settings with the following recommendations?\n\n${validation.warnings.join('\n')}`;
    if (!confirm(confirmMsg)) {
      return false;
    }
  }
  
  // Proceed with original save logic
  return saveSettings();
}
```

**Benefits**:
- ✅ **Prevent invalid configurations** before they reach the engine
- ✅ **Real-time feedback** improves user experience
- ✅ **Educational warnings** help users optimize settings
- ✅ **Reduced support requests** from configuration issues

---

### **PR #4: Testing & Documentation**
**Priority**: Medium | **Effort**: 2-3 hours | **Risk**: Low

#### **Objective**
Comprehensive testing of the new configuration system and updated documentation.

#### **Files to Create/Modify**
- `test/unit/config-merger.test.ts` (NEW)
- `test/integration/user-settings-priority.test.ts` (NEW)
- `README.md` (UPDATE)

#### **Implementation**

**File: `test/unit/config-merger.test.ts`**
```typescript
import { mergeUserSettingsWithDefaults, buildEngineConfig } from '../../src/util/config-merger';
import { DefaultEngineConfig } from '../../optimization/engine';

describe('Configuration Merger', () => {
  const createMockHomey = (settings: Record<string, any> = {}) => ({
    settings: {
      get: jest.fn((key: string) => settings[key])
    }
  });

  describe('mergeUserSettingsWithDefaults', () => {
    it('should use defaults when no user settings provided', () => {
      const homey = createMockHomey({});
      const result = mergeUserSettingsWithDefaults(homey);
      
      expect(result.config).toEqual(DefaultEngineConfig);
      expect(result.userOverrides).toEqual({});
      expect(result.warnings).toEqual([]);
    });

    it('should use valid user settings and track overrides', () => {
      const homey = createMockHomey({
        'comfort_lower_occupied': 21,
        'comfort_upper_occupied': 24,
        'preheat_enable': false
      });
      
      const result = mergeUserSettingsWithDefaults(homey);
      
      expect(result.config.comfortOccupied.lowerC).toBe(21);
      expect(result.config.comfortOccupied.upperC).toBe(24);
      expect(result.config.preheat.enable).toBe(false);
      
      expect(result.userOverrides).toEqual({
        'comfort_lower_occupied': 21,
        'comfort_upper_occupied': 24
      });
    });

    it('should warn about invalid comfort bands and use safe defaults', () => {
      const homey = createMockHomey({
        'comfort_lower_occupied': 23,  // Invalid: higher than upper
        'comfort_upper_occupied': 21
      });
      
      const result = mergeUserSettingsWithDefaults(homey);
      
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].field).toBe('comfort_occupied_band');
      expect(result.warnings[0].message).toContain('must be less than');
      
      // Should fall back to safe defaults
      expect(result.config.comfortOccupied.lowerC).toBe(DefaultEngineConfig.comfortOccupied.lowerC);
      expect(result.config.comfortOccupied.upperC).toBe(DefaultEngineConfig.comfortOccupied.upperC);
    });

    it('should handle invalid numeric values gracefully', () => {
      const homey = createMockHomey({
        'comfort_lower_occupied': 'invalid',
        'comfort_upper_occupied': null,
        'deadband': -1  // Below minimum
      });
      
      const result = mergeUserSettingsWithDefaults(homey);
      
      expect(result.warnings).toHaveLength(3);
      expect(result.config.comfortOccupied.lowerC).toBe(DefaultEngineConfig.comfortOccupied.lowerC);
      expect(result.config.safety.deadbandC).toBe(DefaultEngineConfig.safety.deadbandC);
    });
  });

  describe('buildEngineConfig', () => {
    it('should return clean config without exposing warnings', () => {
      const homey = createMockHomey({
        'comfort_lower_occupied': 20.5,
        'comfort_upper_occupied': 22.5
      });
      
      const config = buildEngineConfig(homey);
      
      expect(config.comfortOccupied.lowerC).toBe(20.5);
      expect(config.comfortOccupied.upperC).toBe(22.5);
      // Should be a clean EngineConfig object
      expect(config).not.toHaveProperty('warnings');
      expect(config).not.toHaveProperty('userOverrides');
    });
  });
});
```

**File: `test/integration/user-settings-priority.test.ts`**
```typescript
import { Optimizer } from '../../src/services/optimizer';
import { createMockHomey } from '../mocks';

describe('User Settings Priority Integration', () => {
  it('should use user comfort settings in optimization decisions', async () => {
    // User sets wide comfort band for aggressive optimization
    const mockHomey = createMockHomey({
      'comfort_lower_occupied': 19.5,
      'comfort_upper_occupied': 24.0,
      'occupied': true,
      'preheat_enable': true
    });

    const optimizer = new Optimizer(mockHomey as any);
    
    // Simulate cheap electricity period
    const cheapPrices = [
      { price: 0.05, timestamp: new Date() },  // Very cheap
      { price: 0.15, timestamp: new Date(Date.now() + 3600000) },
    ];
    
    const result = await optimizer.optimizeTemperature(
      20.0,  // Current indoor temp
      19.5,  // Current target (at comfort lower bound)
      5.0,   // Cold outdoor temp
      cheapPrices,
      0.05   // Current cheap price
    );
    
    // Should increase target toward user's upper bound during cheap period
    expect(result.targetTemperature).toBeGreaterThan(20.0);
    expect(result.targetTemperature).toBeLessThanOrEqual(24.0); // User's upper limit
    expect(result.reason).toContain('cheap');
  });

  it('should respect user preheat preferences', async () => {
    const mockHomeyDisabled = createMockHomey({
      'preheat_enable': false,
      'comfort_lower_occupied': 20,
      'comfort_upper_occupied': 23
    });

    const optimizer = new Optimizer(mockHomeyDisabled as any);
    
    const cheapPrices = [
      { price: 0.05, timestamp: new Date() },
      { price: 0.25, timestamp: new Date(Date.now() + 3600000) },
    ];
    
    const result = await optimizer.optimizeTemperature(
      21.0,  // Current temp in comfort band
      21.0,  // Current target
      8.0,   // Moderate outdoor temp
      cheapPrices,
      0.05   // Cheap price
    );
    
    // Should NOT preheat when user disabled it
    expect(result.targetTemperature).toBe(21.0); // No change
    expect(result.reason).not.toContain('preheat');
  });
});
```

**Update README.md with configuration section**:
```markdown
## ⚙️ Configuration Priority System

The optimizer follows a **user-first** configuration approach:

1. **User Settings** (via Homey app) take highest priority
2. **Validated Defaults** provide safe fallbacks for missing/invalid values
3. **Automatic Validation** prevents configuration errors

### Settings Hierarchy
```
User Setting → Validation → Engine Config → Optimization Decision
     ↓              ↓            ↓              ↓
   20-23°C    →   Valid    →   20-23°C   →   Target: 22°C
   "invalid"  →   Invalid  →   20-21°C   →   Safe fallback
```

### Configuration Validation
The system automatically validates:
- Comfort bands (lower < upper, reasonable ranges)
- Numeric settings (finite numbers, within bounds)
- Cross-dependencies (e.g., preheat settings)

Invalid settings generate warnings and fall back to safe defaults.
```

**Benefits**:
- ✅ **Comprehensive test coverage** for configuration logic
- ✅ **Integration tests** validate end-to-end behavior
- ✅ **Clear documentation** for users and developers
- ✅ **Regression prevention** for future changes

---

## 📊 **Implementation Timeline**

### **Week 1**: Foundation
- **Day 1-2**: PR #1 - Configuration Merger Utility
- **Day 3**: PR #2 - Optimizer Integration Cleanup
- **Day 4-5**: Testing & debugging

### **Week 2**: Enhancement  
- **Day 1-2**: PR #3 - Settings UI Validation
- **Day 3**: PR #4 - Testing & Documentation
- **Day 4-5**: User acceptance testing

### **Total Effort**: ~8-12 hours across 2 weeks

---

## 🎯 **Success Criteria**

### **Technical**
- ✅ All user settings properly override defaults
- ✅ Invalid configurations handled gracefully
- ✅ 90%+ test coverage for configuration logic
- ✅ Zero configuration-related bugs in production

### **User Experience**
- ✅ Settings UI provides immediate feedback
- ✅ Users understand what their settings do
- ✅ Configuration errors prevented before save
- ✅ Optimization behavior matches user expectations

### **Developer Experience**
- ✅ Single source of truth for configuration
- ✅ Easy to add new settings
- ✅ Clear separation of concerns
- ✅ Comprehensive testing framework

---

## 🚀 **Ready to Implement**

Each PR can be implemented independently, allowing for incremental improvement while maintaining system stability. The architecture is designed to be **backward compatible** - existing user settings will continue to work exactly as before, but with better validation and clearer behavior.

**Next Step**: Review and approve PR #1 (Configuration Merger Utility) to establish the foundation for user-first configuration management.