## ADDED Requirements
### Requirement: Heatpump Provider Abstraction
The optimization stack MUST interact with heat pumps exclusively through a vendor-neutral provider interface.

#### Scenario: Optimizer requests device snapshot
- **GIVEN** an initialized provider instance for the configured vendor
- **WHEN** the optimizer needs telemetry for hourly decisions
- **THEN** it retrieves the data via `getSnapshot` on the provider interface without importing vendor-specific modules

#### Scenario: COP estimator fetches energy report
- **GIVEN** the COP helper needs aggregated energy data
- **WHEN** it calls `getEnergyReport`
- **THEN** the provider returns the required metrics or `null` placeholders without throwing vendor-specific errors

### Requirement: Vendor Selection & Settings
Users MUST be able to select their heat pump vendor and provide vendor-specific credentials in the Homey settings UI.

#### Scenario: Legacy install upgrades
- **GIVEN** a user with existing MELCloud credentials updates the app
- **WHEN** the app boots after the update
- **THEN** the vendor defaults to `melcloud`, existing credentials remain intact, and a timeline message notes the active vendor

#### Scenario: myUplink configuration
- **GIVEN** a user selects `myuplink` in settings and provides an access token
- **WHEN** they test the connection
- **THEN** the app validates the token via the provider, lists available devices, and reports success or failure in the UI

### Requirement: Provider Identity in Telemetry
All logs, circuit breaker events, and timeline entries related to heat pump interactions MUST include the active vendor identity.

#### Scenario: Circuit breaker trips
- **GIVEN** repeated failures calling a provider API
- **WHEN** the circuit breaker opens
- **THEN** the log entry and any timeline notification include the vendor identifier so operators can distinguish MELCloud vs myUplink issues
