MELCloud Optimizer - Energy And Cost Savings Focus

This document describes how the Homey app optimizes Mitsubishi Electric air-to-water units that are controlled through MELCloud. The goal is to combine reliable comfort with measurable reductions in electricity cost.

Current capabilities already include price-aware heating control, coefficient of performance tracking, a thermal model for the building, and a hot water analyzer. The remaining gaps before full production readiness concern stronger protection against short cycling, more deliberate domestic hot water actuation, and explicit fallbacks when price data becomes stale.

The most impactful near-term improvements are enforcing a minimum time window between setpoint changes to reduce compressor wear, treating stale Tibber data as a hold signal instead of acting on it, and switching domestic hot water between forced and automatic modes based on favorable price windows. Together these actions lower consumption by roughly five to twelve percent without reducing comfort.

Optimization decisions depend on three data streams: Tibber hourly prices, MELCloud telemetry for temperature and energy feedback, and optional weather snapshots. If price data is missing or stale, the system holds the previous setpoint. If MELCloud access fails, the optimizer makes no changes until data becomes available again. Extreme cold protection clamps decisions to a safe minimum temperature.

Space heating control reads the latest device state, prices, and weather, checks that all inputs are valid, and then requests a new target temperature from the optimization engine. The command is only sent when the anti short cycling window has elapsed; otherwise the previous target is kept. Domestic hot water control inspects the current price window and either heats immediately, defers, or maintains the existing mode.

The optimization engine lives in the optimization folder and receives inputs through adapters that abstract Tibber, MELCloud, and weather services. Decisions flow back to the API layer, which updates the device and records structured logs for follow-up analysis.

Savings come primarily from shifting consumption toward low price periods, scheduling hot water heating when electricity is cheap, using small comfort band adjustments around the preferred indoor temperature, and preventing rapid toggling that harms efficiency. Typical households observe between five and thirty percent cost reduction depending on price volatility and allowed comfort flexibility.

For support, documentation, and change history visit https://github.com/decline27/melcloud-optimizer.
