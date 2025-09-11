# MELCloud Optimizer Development Instructions

**Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

## Working Effectively

### Bootstrap, Build, and Test the Repository

**NEVER CANCEL any build or test commands - they may take significant time to complete.**

1. **Install Node.js and dependencies:**
   ```bash
   # Requires Node.js >= 16.0.0
   npm install
   # Takes ~10-15 seconds, downloads ~293 packages
   ```

2. **Install Homey CLI globally (required for full builds):**
   ```bash
   npm install -g homey
   # Takes ~30-45 seconds, downloads ~478 packages
   ```

3. **Build and validate the application:**
   ```bash
   # TypeScript compilation only (fast)
   npm run build:ts
   # Takes ~3 seconds - NEVER CANCEL

   # Full Homey app build with validation
   npm run build  
   # Takes ~6-8 seconds - NEVER CANCEL

   # Homey app validation only
   npm run validate
   # Takes ~4 seconds - NEVER CANCEL
   ```

4. **Run tests with appropriate timeouts:**
   ```bash
   # Unit tests only (CI environment - skips integration tests)
   CI=true npm test
   # Takes ~18-20 seconds, 420 tests - NEVER CANCEL, SET TIMEOUT 60+ SECONDS

   # Unit tests with coverage
   npm run test:coverage  
   # Takes ~18-25 seconds - NEVER CANCEL, SET TIMEOUT 60+ SECONDS

   # Full build + test pipeline
   npm run clean && npm run build && npm run test:coverage
   # Takes ~25-30 seconds total - NEVER CANCEL, SET TIMEOUT 90+ SECONDS
   ```

### Critical Timing and Timeout Information

**⚠️ CRITICAL: All build and test commands MUST use timeouts of 60+ seconds minimum.**

| Command | Expected Time | Minimum Timeout | Notes |
|---------|---------------|-----------------|--------|
| `npm install` | 10-15s | 60s | Initial dependency installation |
| `npm install -g homey` | 30-45s | 90s | Homey CLI installation |
| `npm run build:ts` | 2-3s | 30s | TypeScript compilation only |
| `npm run build` | 6-8s | 60s | Full Homey build with validation |
| `npm test` (CI=true) | 18-20s | 60s | Unit tests, 420 tests, skips integration |
| `npm run test:coverage` | 18-25s | 60s | Unit tests with coverage reporting |
| Full pipeline | 25-30s | 90s | Clean + build + test with coverage |

**⚠️ NEVER CANCEL builds or tests. Coverage threshold may fail (currently 63% vs 70% target) but tests will pass.**

### Test Coverage and Open Handles

- **Expected behavior**: Tests pass but coverage threshold fails (63.13% branches vs 70% target)
- **Warning messages**: "A worker process has failed to exit gracefully" - this is normal
- **Open handles**: Tests may show open handle warnings - this is expected behavior
- **Exit code**: Will be 1 due to coverage threshold, but all 420 tests pass successfully

## Running the Application

### Development Mode
```bash
# Note: Requires Homey device connection - will not work in standard environments
npm run dev
# Equivalent to: homey app run --debug
```

### Simulation and Testing
```bash
# Run optimization algorithm simulation (stub implementation)
npm run simulate
# Uses: scripts/simulate.js with data from data/ directory
```

## Integration Tests

### Setup for Integration Tests (Optional)
Integration tests require real MELCloud and Tibber API credentials and will fail without internet access.

1. **Copy example configuration:**
   ```bash
   cp test/config.example.json test/config.json
   ```

2. **Add real credentials to test/config.json (if available):**
   ```json
   {
     "melcloud": {
       "email": "your-melcloud-email@example.com", 
       "password": "your-melcloud-password"
     },
     "tibber": {
       "token": "your-tibber-api-token"
     },
     "test": {
       "skipIntegration": false,
       "timeout": 30000
     }
   }
   ```

3. **Run integration tests (will fail without real credentials):**
   ```bash
   CI= npm run test:integration
   # Takes 60-90 seconds to fail with network errors - this is expected
   ```

**Note**: Integration tests are automatically skipped in CI environments. They require real API access and will fail in sandboxed environments.

## Linting and Code Quality

### ESLint Status
- **Current status**: ESLint configuration needs migration from v6 to v9 format
- **Legacy config**: Uses `.eslintrc.json` (deprecated) 
- **Migration needed**: Convert to `eslint.config.js` format
- **Workaround**: TypeScript compiler provides type checking instead

### Code Quality Checks
```bash
# TypeScript type checking (use instead of ESLint for now)
npm run build:ts

# Test coverage reporting
npm run test:coverage
```

## Validation Scenarios

### Manual Testing Procedures
1. **Build validation**: Run full build pipeline and verify no errors
2. **Test validation**: Run unit tests and verify 420 tests pass  
3. **Coverage validation**: Verify coverage reports generate (threshold failure expected)
4. **Simulation validation**: Run simulate command and verify stub output
5. **Integration test behavior**: Verify integration tests fail gracefully without credentials

### Example Validation Workflow
```bash
# Complete validation sequence - takes ~30 seconds total
npm run clean
npm run build  
CI=true npm test
npm run simulate

# Expected results:
# - Build: ✓ App built successfully  
# - Tests: ✓ 420 tests passed (coverage threshold fails)
# - Simulate: ✓ Simulation script output shown
```

## Key Codebase Navigation

### Repository Structure
```
melcloud-optimizer/
├── src/                     # TypeScript source code
│   ├── services/           # Core services (MELCloud, Tibber, Optimizer)
│   ├── util/               # Utility functions and helpers
│   └── types/              # TypeScript type definitions
├── test/                   # Comprehensive test suite
│   ├── unit/               # Unit tests (420 tests)
│   ├── integration/        # Integration tests (require credentials)
│   └── mocks/              # Mock implementations
├── optimization/           # Pure optimization engine
├── data/                   # Sample data for simulation
├── api.js                  # Legacy JavaScript API layer (240KB)
└── scripts/               # Utility scripts
```

### Important Files
- **Core Application**: `src/app.ts` - Main Homey app class
- **Optimization Logic**: `src/services/optimizer.ts` - Core optimization algorithms
- **API Integration**: `src/services/melcloud-api.ts`, `src/services/tibber-api.ts`
- **Configuration**: `package.json`, `tsconfig.json`, `jest.config.js`
- **Build Output**: `.homeybuild/` (generated, git-ignored)

### Frequently Used Commands
```bash
# Quick development cycle
npm run build:ts && CI=true npm test

# Full validation before committing  
npm run clean && npm run build && npm run test:coverage

# Check app structure
npm run validate
```

## Troubleshooting

### Common Issues and Solutions

1. **"homey: command not found"**
   - Solution: `npm install -g homey`
   - Required for: `npm run build`, `npm run validate`

2. **Coverage threshold failures**
   - Expected: 63% branches vs 70% target
   - Action: This is normal, continue with development

3. **ESLint configuration errors**
   - Issue: Deprecated .eslintrc.json format
   - Workaround: Use TypeScript compiler for type checking
   - Command: `npm run build:ts`

4. **Integration test failures**
   - Expected: Network errors without real credentials
   - Action: Use CI=true npm test for unit tests only

5. **Test open handles warnings**
   - Expected: "worker process failed to exit gracefully"
   - Action: Normal behavior, tests still pass

### Memory and Performance
- **Normal memory usage**: Tests may take 18-25 seconds
- **Expected warnings**: Open handles, coverage thresholds
- **Performance**: Full pipeline completes in under 30 seconds

## Working with the Optimization Engine

### Key Components
- **Pure Engine**: `optimization/engine.ts` - DI-friendly optimization logic
- **Configuration**: `optimization/config.example.json` - Engine parameters
- **Integration**: `src/services/optimizer.ts` - Homey app integration

### Testing Optimization Changes
1. **Unit tests**: Test individual components in `test/unit/optimizer*.test.ts`
2. **Simulation**: Use `npm run simulate` for algorithm comparison
3. **Integration**: Test with real data via integration tests (requires credentials)

Always test optimization changes with the simulation framework before deploying to real devices.

## CI/CD Considerations

### GitHub Workflows
- **Validation**: `.github/workflows/homey-app-validate.yml`
- **Node.js version**: 18 (specified in CI)
- **Dependencies**: Installs TypeScript globally in CI
- **Test behavior**: Integration tests skipped in CI environment

### Pre-commit Checklist
- [ ] `npm run build` - Verify build succeeds  
- [ ] `CI=true npm test` - Verify unit tests pass
- [ ] `npm run validate` - Verify Homey app validation
- [ ] Test coverage generated (threshold failure expected)

---

**Remember: Always wait for commands to complete. Set timeouts of 60+ seconds for builds and tests. NEVER CANCEL long-running operations.**