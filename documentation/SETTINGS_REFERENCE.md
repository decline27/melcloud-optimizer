# MELCloud Optimizer - Settings Reference

> Complete reference for all configuration parameters in the MELCloud Heat Pump Optimizer.

**Last Updated:** December 4, 2025

> [!IMPORTANT]
> All settings listed below are **user-configurable** via the Homey settings page. The "Default" column shows initial values only - users can change these to match their preferences. Code must always read current values from `SettingsLoader`, never assume defaults.

---

## Temperature Zone Settings

### Zone 1 (Primary Heating)

| Setting Key | Default | Range | Description |
|-------------|---------|-------|-------------|
| `comfort_lower_occupied` | 20.0°C | 15-25°C | Minimum temperature when home is occupied |
| `comfort_upper_occupied` | 21.0°C | 15-25°C | Maximum temperature when home is occupied |
| `comfort_lower_away` | 19.0°C | 15-25°C | Minimum temperature when away |
| `comfort_upper_away` | 20.5°C | 15-25°C | Maximum temperature when away |

### Zone 2 (Secondary Heating)

| Setting Key | Default | Range | Description |
|-------------|---------|-------|-------------|
| `zone2_enabled` | false | boolean | Enable Zone 2 optimization |
| `min_temp_zone2` | 17.0°C | 15-25°C | Minimum Zone 2 setpoint |
| `max_temp_zone2` | 22.0°C | 15-25°C | Maximum Zone 2 setpoint |
| `temp_step_zone2` | 0.5°C | 0.5-1.0°C | Step size for Zone 2 adjustments |

### Hot Water Tank

| Setting Key | Default | Range | Description |
|-------------|---------|-------|-------------|
| `tank_min` | 40°C | 35-60°C | Minimum tank temperature |
| `tank_max` | 55°C | 40-70°C | Maximum tank temperature |
| `tank_step` | 1.0°C | 0.5-2.0°C | Step size for tank adjustments |

---

## Safety & Constraint Settings

| Setting Key | Default | Range | Description |
|-------------|---------|-------|-------------|
| `min_setpoint_change_minutes` | 30 | 1-180 min | Minimum time between setpoint changes (anti-cycling) |
| `deadband_c` | 0.5 | 0.1-2.0°C | Minimum temperature change threshold |
| `temp_step_max` | 0.5 | 0.5-1.0°C | Maximum temperature step per cycle |

---

## COP (Coefficient of Performance) Settings

| Setting Key | Default | Range | Description |
|-------------|---------|-------|-------------|
| `cop_weight` | 0.3 | 0-1 | How much COP influences optimization decisions |
| `auto_seasonal_mode` | true | boolean | Auto-detect summer/winter based on date |
| `summer_mode` | false | boolean | Manual summer mode override |

---

## Price Settings

| Setting Key | Default | Range | Description |
|-------------|---------|-------|-------------|
| `preheat_cheap_percentile` | 0.25 | 0.05-0.5 | Threshold for "cheap" electricity (25th percentile) |
| `grid_fee_per_kwh` | 0 | 0+ | Fixed grid fee added to spot price (local currency/kWh) |
| `currency_code` | NOK | string | Display currency (NOK, SEK, EUR, etc.) |

### Price Provider Selection

| Setting Key | Values | Description |
|-------------|--------|-------------|
| `price_provider` | `tibber`, `entsoe` | Which API to fetch prices from |
| `tibber_api_key` | string | Tibber API token (required for Tibber) |
| `entsoe_area_eic` | string | ENTSO-E bidding zone EIC code |
| `entsoe_security_token` | string | ENTSO-E API token (optional, has default) |

### Consumer Markup (ENTSO-E Only)

| Setting Key | Default | Description |
|-------------|---------|-------------|
| `enable_consumer_markup` | false | Add retailer markup to spot prices |
| `consumer_markup_config` | JSON | Markup configuration (tiered pricing) |
| `markup_currency_unit` | LOCAL | Markup currency (LOCAL or EUR) |

---

## Timezone Settings

| Setting Key | Default | Range | Description |
|-------------|---------|-------|-------------|
| `time_zone_offset` | 1 | -12 to 14 | UTC offset in hours |
| `use_dst` | false | boolean | Adjust for daylight saving time |
| `time_zone_name` | "" | IANA name | e.g., "Europe/Stockholm" |

---

## Occupancy State

| Setting Key | Default | Description |
|-------------|---------|-------------|
| `occupied` | true | Current home/away state |

---

## Thermal Model Storage Keys

These are internal storage keys managed by the thermal learning system:

| Key | Description |
|-----|-------------|
| `thermal_model_characteristics` | Learned thermal properties (heatingRate, coolingRate, thermalMass, confidence) |
| `thermal_model_data` | Raw thermal data points (capped at 356 points) |
| `thermal_model_aggregated_data` | Aggregated thermal data (capped at 307 points) |

---

## COP Tracking Storage Keys

| Key | Description |
|-----|-------------|
| `cop_guards_v1` | COP normalization state (min/max observed, history) |
| `cop_snapshots_daily` | Daily COP snapshots |
| `cop_snapshots_weekly` | Weekly COP aggregates |

---

## Adaptive Learning Storage Keys

| Key | Description |
|-----|-------------|
| `adaptive_business_parameters` | Learned price sensitivity, COP thresholds, learning cycles |

---

## Savings & Metrics Storage Keys

| Key | Description |
|-----|-------------|
| `savings_history` | Daily savings records (30-day rolling) |
| `display_savings_history` | Formatted savings for UI display |
| `orchestrator_metrics` | Optimization run statistics |

---

## State Tracking Keys

| Key | Description |
|-----|-------------|
| `last_setpoint_change_ms` | Zone 1 last change timestamp |
| `last_issued_setpoint_c` | Zone 1 last issued setpoint |
| `last_zone2_setpoint_change_ms` | Zone 2 last change timestamp |
| `last_zone2_issued_setpoint_c` | Zone 2 last issued setpoint |
| `last_tank_setpoint_change_ms` | Tank last change timestamp |
| `last_tank_issued_setpoint_c` | Tank last issued setpoint |

---

## Hot Water Learning Storage Keys

| Key | Description |
|-----|-------------|
| `hot_water_usage_data` | Raw hot water usage data points |
| `hot_water_aggregated_data` | Aggregated usage patterns |
| `hot_water_usage_patterns` | Learned peak hours and demand curves |

---

## Debug & Development

| Setting Key | Description |
|-------------|-------------|
| `verbose_logging` | Enable detailed logging |
| `DEBUG_OPT_EXPORT` | Export optimization data as JSON snapshot |

---

## See Also

- [USER_GUIDE.md](./USER_GUIDE.md) - End-user documentation
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
- [SERVICES_REFERENCE.md](./SERVICES_REFERENCE.md) - Service documentation
