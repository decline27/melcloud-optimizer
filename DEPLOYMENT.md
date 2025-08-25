# Deployment Guide

> **Production deployment instructions for MELCloud Optimizer**

## 🚀 Pre-deployment Checklist

### Code Quality
- [ ] All TypeScript compilation successful (`npm run build:ts`)
- [ ] No ESLint errors or warnings
- [ ] All tests passing (`npm test`)
- [ ] Code coverage meets minimum requirements (>45%)

### Functional Testing
- [ ] Manual testing of core optimization workflows
- [ ] API endpoints responding correctly
- [ ] Memory usage within acceptable limits
- [ ] Timeline entries being created properly

### Documentation
- [ ] README.md updated with latest features
- [ ] CHANGELOG.md updated with version changes
- [ ] Version numbers updated in package.json and app.json
- [ ] Breaking changes documented

## 🔧 Build Process

### 1. Clean Build

```bash
# Clean previous builds
npm run clean
rm -rf .homeybuild/
rm -rf node_modules/

# Fresh install
npm install
```

### 2. TypeScript Compilation

```bash
# Compile TypeScript
npm run build:ts

# Verify compilation
ls -la .homeybuild/src/
```

### 3. Testing

```bash
# Run full test suite
npm test

# Integration tests
npm run test:integration

# Coverage report
npm run test:coverage
```

### 4. Homey App Build

```bash
# Build Homey app package
npm run build

# Verify build output
ls -la .homeybuild/
```

## 📦 Release Process

### Version Management

1. **Update version numbers**:
   ```bash
   # package.json
   "version": "12.5.5"
   
   # .homeycompose/app.json
   "version": "12.5.5"
   ```

2. **Update changelog**:
   - Add new version section to CHANGELOG.md
   - Document all changes, fixes, and new features
   - Include migration notes if needed

### Homey App Store Deployment

#### 1. Homey CLI Setup

```bash
# Install Homey CLI globally
npm install -g @athombv/homey-cli

# Login to Homey developer account
homey login

# Verify account
homey whoami
```

#### 2. App Validation

```bash
# Validate app structure
homey app validate

# Check for common issues
homey app build --validate
```

#### 3. Publishing

```bash
# Publish to Homey App Store
homey app publish

# Check publication status
homey app versions
```

## 🔍 Quality Assurance

### Automated Checks

The deployment process includes these automated validations:

1. **TypeScript Compilation**: Zero errors required
2. **Test Suite**: All tests must pass
3. **Homey Validation**: App structure validation
4. **Memory Usage**: Performance within limits
5. **API Compatibility**: Backward compatibility maintained

### Manual Testing Checklist

- [ ] **Installation**: Fresh install on test Homey
- [ ] **Configuration**: Settings page functional
- [ ] **API Credentials**: MELCloud and Tibber authentication
- [ ] **Device Discovery**: Heat pump devices detected
- [ ] **Optimization**: Manual optimization works
- [ ] **Scheduling**: Cron jobs initialize properly
- [ ] **Timeline**: Entries created correctly
- [ ] **Memory**: Usage within normal ranges

## 📊 Monitoring & Rollback

### Post-Deployment Monitoring

Monitor these metrics after deployment:

1. **Installation Success Rate**: Track failed installations
2. **Memory Usage**: Monitor memory consumption patterns  
3. **API Error Rates**: Watch for increased error rates
4. **User Reports**: Track support requests and bug reports

### Rollback Procedure

If issues are discovered post-deployment:

1. **Immediate**: Contact Homey App Store team
2. **Communication**: Notify users via community forums
3. **Fix**: Prepare hotfix version with critical fixes
4. **Release**: Emergency release with fixes

## 🏗️ Infrastructure Requirements

### Homey Platform Requirements

- **Homey Pro**: Version 12.2.0 or higher
- **Node.js**: Version 12+ (provided by Homey)
- **Memory**: ~50-100MB available
- **Network**: Internet connection for API calls

### External Dependencies

- **MELCloud API**: Must be accessible
- **Tibber API**: GraphQL endpoint availability
- **Met.no Weather API**: For weather data (optional)

### Rate Limits & Quotas

- **MELCloud**: ~1 request/minute per device
- **Tibber**: 100 requests/hour per token
- **Weather**: No strict limits, reasonable usage expected

## 🔐 Security Considerations

### Credential Management

- **API Tokens**: Stored encrypted in Homey settings
- **User Credentials**: Never logged or transmitted insecurely
- **Error Messages**: Sanitized to prevent information disclosure

### Network Security

- **HTTPS Only**: All API calls use encrypted connections
- **Certificate Validation**: Proper SSL certificate checking
- **Input Validation**: All user inputs sanitized

## 📈 Performance Optimization

### Memory Management

The app implements intelligent memory management:

```typescript
// Memory thresholds
const NORMAL_CLEANUP_THRESHOLD = 75;    // 75% memory usage
const AGGRESSIVE_CLEANUP_THRESHOLD = 85; // 85% memory usage

// Automatic cleanup triggers
if (memoryUsage > AGGRESSIVE_CLEANUP_THRESHOLD) {
  await performAggressiveCleanup();
} else if (memoryUsage > NORMAL_CLEANUP_THRESHOLD) {
  await performNormalCleanup();
}
```

### Performance Targets

- **Response Time**: <200ms for API calls
- **Memory Usage**: <100MB peak, <50MB typical
- **CPU Usage**: <1% average
- **Network Traffic**: <50KB/hour

## 🎯 Feature Flags & Configuration

### Production Configuration

```typescript
// Production settings
const PRODUCTION_CONFIG = {
  logLevel: 'info',
  enableDetailedLogging: false,
  memoryCleanupInterval: 3600000, // 1 hour
  maxThermalDataPoints: 10000,
  apiTimeoutMs: 30000
};
```

### Feature Toggles

The app supports runtime feature toggles:

- **Thermal Learning**: Can be disabled per user
- **Weather Integration**: Optional weather-based optimization
- **Advanced COP**: COP-based optimization toggle
- **Memory Monitoring**: Diagnostic memory tracking

## 📞 Support & Maintenance

### Support Channels

- **Primary**: GitHub Issues for bug reports
- **Community**: Homey Community forums
- **Direct**: email support for critical issues

### Maintenance Schedule

- **Weekly**: Monitor memory usage and performance
- **Monthly**: Review user feedback and plan improvements
- **Quarterly**: Performance optimization and code review

---

## Emergency Contacts

- **Homey App Store Support**: support@homey.app
- **Developer**: decline27@gmail.com
- **Community Manager**: (via Homey Community)

---

This deployment guide ensures reliable, secure, and performant releases of the MELCloud Optimizer app.