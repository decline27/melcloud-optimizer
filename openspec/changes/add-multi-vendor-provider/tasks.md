## 1. Planning & Interfaces
- [x] 1.1 Confirm optimizer dependencies on MELCloud interactions
- [x] 1.2 Draft IHeatpumpProvider interface & shared types

## 2. Provider Abstractions
- [x] 2.1 Wrap existing MELCloud logic into MELCloudProvider
- [x] 2.2 Scaffold MyUplinkProvider with TODO-marked endpoints and rate limiting
- [x] 2.3 Implement provider factory and initialization flow in orchestration

## 3. Settings & Migration
- [ ] 3.1 Extend settings schema + UI with vendor selection and credentials
- [x] 3.2 Add migration defaulting legacy installs to MELCloud vendor and log timeline entry

## 4. Utilities & Telemetry
- [x] 4.1 Add HTTP client helpers with circuit breaker, caching, and retries per base URL
- [ ] 4.2 Ensure logging/timeline prefixed with provider identity

## 5. Tests & Docs
- [ ] 5.1 Add provider unit/contract tests and update optimizer tests
- [ ] 5.2 Create README_MULTI_VENDOR.md describing setup for MELCloud and myUplink
- [ ] 5.3 Run lint/build/test suite
