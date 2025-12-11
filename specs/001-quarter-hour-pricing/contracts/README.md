# Contracts: Quarter-Hour Pricing for DHW & Planning Bias

No new external API contracts are introduced. Changes are internal to price ingestion and optimization:
- Providers: Tibber and ENTSO-E price payloads augmented with `quarterHourly` and `intervalMinutes` (when available) alongside existing hourly data.
- Consumers: Hot water optimizer and planning bias logic may read quarter-hour arrays; they must fall back to hourly when cadence is missing or inconsistent.

If future external surfaces change (e.g., settings UI), update this file with request/response shapes and validation rules.
