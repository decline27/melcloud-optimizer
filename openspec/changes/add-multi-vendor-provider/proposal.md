## Why
- Current optimizer is tightly coupled to MELCloud, blocking support for myUplink and future vendors.
- Homey users request NIBE myUplink integration; lack of abstraction causes high regression risk if we bolt it on.
- Need a clear migration path that preserves existing MELCloud behavior while enabling vendor selection in settings.

## What Changes
- Introduce a vendor-agnostic heat pump provider interface consumed by orchestration, optimizer, COP, and hot water services.
- Wrap existing MELCloud integration behind the new provider and scaffold a myUplink provider with rate-limited HTTP utilities.
- Extend settings schema/UI with vendor selection, credential inputs, and connection testing plus migrations defaulting legacy installs to MELCloud.
- Update logging, timeline metadata, and tests to respect provider identity.
- Document setup/developer workflow for multi-vendor support.

## Impact
- Backwards compatible default vendor (MELCloud) with preserved credentials and historical data.
- Adds TODO-gated placeholders for myUplink endpoints pending final API mapping.
- Requires refactoring optimizer dependencies; regression risk mitigated by contract tests and integration smoke tests.
- Slight increase in bundle size and settings complexity; offset by reuse of provider factory.
