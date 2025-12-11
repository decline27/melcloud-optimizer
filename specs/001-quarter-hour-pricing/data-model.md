# Data Model: Quarter-Hour Pricing for DHW & Planning Bias

## Entities

- **Price Slot**
  - Attributes: `time` (ISO string), `price` (numeric), `intervalMinutes` (15 or 60), `currencyCode`, `baseCurrency?`, `provider` (Tibber|ENTSO-E), `quality` (valid|fallback|incomplete).
  - Notes: Derived from provider payload; quarter-hour series may be aggregated to hourly for fallback while preserving raw 15m when present.

- **DHW Block Candidate**
  - Attributes: `startTime`, `endTime`, `slots` (list of Price Slots), `averagePrice`, `peakPrice`, `durationMinutes`, `meetsRamp` (bool), `eligible` (bool + reason).
  - Notes: Built from contiguous cheap 15m slots; must satisfy ≥30m duration and tank/ramp/legionella constraints.

- **Volatility Indicator**
  - Attributes: `hourStart`, `avgPrice`, `maxPrice`, `spikeRatio` (max/avg), `isRisky` (bool).
  - Notes: Drives planning bias risk flagging when `spikeRatio` > 1.25; only applied if quarter-hour data exists and is consistent.

## Relationships

- Price Slots feed both DHW Block Candidates and Volatility Indicators.
- Volatility Indicators annotate hourly windows used by planning bias; DHW Blocks are independent of room setpoint cadence but still respect anti-cycling and tank constraints.

## Validation & Constraints

- Cadence consistency: 15m series must be contiguous; otherwise mark `quality=fallback` and use hourly prices.
- Minimum block duration: 30 minutes (2×15m) before eligible.
- Planning bias risk: risky when `maxPrice > avgPrice * 1.25`.
- Room heating cadence: decisions must not increase room setpoint frequency beyond hourly.
