MELCloud Optimizer - Energy And Cost Savings Focus

This document describes how the Homey app optimizes Mitsubishi Electric air-to-water units that are controlled through MELCloud. The goal is to combine reliable comfort with measurable reductions in electricity cost.

Current capabilities already include price-aware heating control, coefficient of performance tracking, a thermal model for the building, and a hot water analyzer. The remaining gaps before full production readiness concern stronger protection against short cycling, more deliberate domestic hot water actuation, and explicit fallbacks when price data becomes stale.

The most impactful near-term improvements are enforcing a minimum time window between setpoint changes to reduce compressor wear, treating stale Tibber data as a hold signal instead of acting on it, and switching domestic hot water between forced and automatic modes based on favorable price windows. Together these actions lower consumption by roughly five to twelve percent without reducing comfort.

Optimization decisions depend on three data streams: Tibber hourly prices, MELCloud telemetry for temperature and energy feedback, and optional weather snapshots. If price data is missing or stale, the system holds the previous setpoint. If MELCloud access fails, the optimizer makes no changes until data becomes available again. Extreme cold protection clamps decisions to a safe minimum temperature.

Space heating control reads the latest device state, prices, and weather, checks that all inputs are valid, and then requests a new target temperature from the optimization engine. The command is only sent when the anti short cycling window has elapsed; otherwise the previous target is kept. Domestic hot water control inspects the current price window and either heats immediately, defers, or maintains the existing mode.

The optimization engine lives in the optimization folder and receives inputs through adapters that abstract Tibber, MELCloud, and weather services. Decisions flow back to the API layer, which updates the device and records structured logs for follow-up analysis.

Savings come primarily from shifting consumption toward low price periods, scheduling hot water heating when electricity is cheap, using small comfort band adjustments around the preferred indoor temperature, and preventing rapid toggling that harms efficiency. Typical households observe between five and thirty percent cost reduction depending on price volatility and allowed comfort flexibility.

For support, documentation, and change history visit https://github.com/decline27/melcloud-optimizer.

## ENTSO-E Day-Ahead Prices

The app now includes a standalone ENTSO-E client so you can fetch day-ahead prices for any European bidding zone without relying on Tibber. The new module parses the XML response, converts EUR/MWh to EUR/kWh (and optionally SEK/kWh), caches identical requests for six hours, and exposes a simple TypeScript API.

Key building blocks:
- `src/entsoe.ts` exports `fetchPrices(homey, zoneInput, startUtc, endUtc, options?)` and `resolveZoneToEic()`.
- `entsoe_area_map.json` contains default ISO → EIC mappings (multiple EICs per country supported).
- `assets/settings/index.html` provides a lightweight settings UI with search, locale detection, clipboard copy, and JSON editing for the map.
- A new flow action **“Fetch ENTSO-E day-ahead prices”** returns the hourly price array as a JSON token for use in Homey flows.

### Example usage

```ts
import { fetchPrices } from './entsoe';

const start = new Date().toISOString();
const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const prices = await fetchPrices(homey, 'SE', start, end, {
  fxRateEurToSek: 11.2,
  useCurrencyConversion: true,
});

console.log(prices[0]);
```

### Configuration steps

1. **Install dependencies** – `npm install` (Node.js ≥16).
2. **Choose price provider** – in the Homey settings, select either Tibber (requires your own API token) or ENTSO-E (uses the bundled token). Tibber remains the default for existing setups.
3. **Get an ENTSO-E security token (optional)** – create an account at [transparency.entsoe.eu](https://transparency.entsoe.eu) and enter it if you prefer to run with your own credentials instead of the bundled token.
4. **Select your price area** – open `assets/settings/index.html` from Homey’s app settings, use the search or “Detect Country” button, and confirm that `entsoe_area_eic` is stored.
5. **Currency conversion** – nothing to configure. ENTSO-E prices are converted automatically to the currency you selected under Homey’s localisation settings. Historical rates are cached for resilience, and manual overrides are no longer required.
6. **Override the area map (optional)** – edit/download/upload `entsoe_area_map.json` from the settings UI or run `scripts/generate_entsoe_area_map.py` to regenerate the JSON from ENTSO-E’s area directory.

### Environment variables & shared tokens

- **Local development** – copy `env.json.example` to `env.json` (kept out of git) and fill in `ENTSOE_TOKEN`. Run the app with `homey app run --env-file env.json` (or `homey app install --env-file env.json`) so the token is injected for your session.
- **Production / App Store** – when deploying, set `ENTSOE_TOKEN` via `homey app env set com.melcloud.optimize ENTSOE_TOKEN <token>` or through the Homey App Store submission UI. Homey stores the value encrypted on each hub and exposes it to the app as `process.env.ENTSOE_TOKEN`.
- **Fallback** – if no environment variable is present, the code falls back to `entsoe_security_token` stored in the Homey app settings, allowing per-user tokens when desired.
- **Security note** – the token is never logged or bundled with the .homeyapp archive. Rotate the shared token periodically and prefer the environment variable path when distributing a central credential.

### Manual testing checklist

1. `npm install`
2. Set `entsoe_security_token` in Homey app settings.
3. Use the settings UI to store `entsoe_area_eic` (verify clipboard copy and Homey persistence).
4. Run the app (`homey app run`) and trigger the “Fetch ENTSO-E day-ahead prices” flow action – confirm a JSON array with 24 hourly entries including EUR/MWh and EUR/kWh values.
5. Test error handling by supplying an invalid token or EIC and confirm the thrown error contains the ENTSO-E status/body details.
