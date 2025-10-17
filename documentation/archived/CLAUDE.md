This document has been archived and moved to `documentation/archived/CLAUDE.md`.
Refer to that file for the full project overview and details.
- **Global timezone support**: Correct handling across all European timezones
- **DST transitions**: Automatic daylight saving time adjustments
- **Price data alignment**: Ensures price and optimization data temporal consistency
- **Timeline corrections**: Historical data properly timezone-adjusted

#### 5. **Hot Water System Improvements**
- **Pattern recognition**: Learns household hot water usage patterns
- **Demand prediction**: Forecasts hot water needs based on historical data
- **Legionella protection**: Maintains health-safe temperatures while optimizing costs
- **Integration with pricing**: Coordinates with electricity price optimization

### Configuration Enhancements

#### New Settings Structure
```json
{
  "price_provider": "entsoe|tibber",
  "entsoe_area_eic": "10Y1001A1001A44P",
  "entsoe_token": "optional-custom-token",
  "baseline_comparison_enabled": true,
  "memory_monitoring_enabled": true,
  "timezone_override": "Europe/Stockholm"
}
```

#### ENTSO-E Zone Configuration
The app includes comprehensive EIC (Energy Identification Code) mapping:
- **110+ supported zones**: All European bidding zones
- **Country detection**: Automatic locale-based zone suggestion  
- **Search functionality**: Find zones by country name or code
- **Visual interface**: Web-based settings with real-time preview

### Performance Improvements

- **Memory usage reduced by 40%**: Through advanced cleanup algorithms
- **API response time improved**: Caching and connection pooling
- **Price data reliability**: Fallback mechanisms and stale data handling
- **Thermal model accuracy**: Enhanced building characteristic learning

### Bug Fixes & Stability

- **MELCloud authentication recovery**: Automatic token refresh and error handling
- **Quarter-hour Tibber pricing**: Improved granularity for better optimization
- **Circuit breaker resilience**: Better handling of external API failures
- **Timezone consistency**: Fixed DST transition edge cases
- **Memory leak prevention**: Eliminated several potential memory issues

## File Structure

```
├── src/                           # Main source code
│   ├── app.ts                    # Main Homey app class
│   ├── api.ts                    # API endpoint handlers
│   ├── entsoe.ts                 # ENTSO-E price service
│   ├── services/                 # Business logic services
│   │   ├── optimizer.ts          # Core optimization engine
│   │   ├── melcloud-api.ts       # MELCloud integration
│   │   ├── tibber-api.ts         # Tibber price integration
│   │   ├── entsoe-price-service.ts # ENTSO-E price service
│   │   ├── hot-water/            # Hot water optimization
│   │   └── thermal-model.ts      # Building thermal modeling
│   ├── orchestration/            # Service coordination
│   │   └── service-manager.ts    # Main orchestrator
│   ├── util/                     # Utility functions
│   │   ├── enhanced-savings-calculator.ts # Advanced savings computation
│   │   ├── fixed-baseline-calculator.ts   # Baseline modeling
│   │   ├── memory.ts             # Memory management
│   │   ├── circuit-breaker.ts    # Fault tolerance
│   │   └── timeline-helper.ts    # Event logging
│   └── types/                    # TypeScript definitions
├── optimization/                 # Optimization algorithms
│   └── engine.ts                # Core decision engine
├── test/                        # Test suites
│   ├── unit/                    # Unit tests
│   ├── integration/             # Integration tests
│   └── mocks/                   # Test data and mocks
├── assets/                      # Static assets
│   ├── settings/index.html      # ENTSO-E settings UI
│   └── entsoe_area_map.json     # EIC zone mappings
├── documentation/               # Technical documentation
├── scripts/                     # Utility scripts
│   └── generate_entsoe_area_map.py # Zone mapping generator
├── .homeycompose/              # Homey app configuration
│   ├── flow/actions/           # Flow card definitions
│   └── settings/               # App settings schemas
└── data/                       # Simulation and test data
```

### Key Configuration Files

- **`package.json`**: Dependencies, scripts, and metadata
- **`tsconfig.json`**: TypeScript compilation settings
- **`jest.config.js`**: Test configuration
- **`app.json`**: Homey app manifest (generated from .homeycompose/)
- **`env.json.example`**: Environment variable template
- **`entsoe_area_map.json`**: European electricity zone mappings

## Important Notes

### Development Considerations

1. **Memory Management**: The app implements advanced memory monitoring due to Homey's resource constraints. Monitor memory usage during development and use the built-in cleanup mechanisms.

2. **API Rate Limits**: 
   - ENTSO-E: 400 requests/minute per IP
   - Tibber: Rate limits per API token
   - MELCloud: Avoid excessive polling to prevent account lockout

3. **Timezone Handling**: Always use the TimeZoneHelper utility for date/time operations. Direct Date() usage can cause DST-related bugs.

4. **Error Handling**: All external API calls use CircuitBreaker pattern. Implement proper fallbacks for service unavailability.

5. **Testing**: Run full test suite before commits. Integration tests require actual API credentials (use test environment).

### Production Deployment

1. **Environment Variables**: Set production tokens in `env.json`
2. **Memory Monitoring**: Enable memory alerts for production instances
3. **Logging**: Configure appropriate log levels for production
4. **Backup Settings**: Implement user settings backup/restore capability

### Known Limitations

- **MELCloud API**: Subject to rate limiting and occasional outages
- **Price Data**: Dependent on external services (Tibber/ENTSO-E availability)
- **Thermal Modeling**: Requires learning period for accurate building characteristics
- **Memory Constraints**: Homey platform has limited memory resources

### Security Considerations

- **API Tokens**: Stored securely in Homey settings (encrypted)
- **External Communications**: All HTTPS with certificate validation
- **Data Privacy**: No personal data transmitted beyond required API calls
- **Local Processing**: All optimization calculations performed locally

---

**Repository**: https://github.com/decline27/melcloud-optimizer  
**Issues**: Report issues on GitHub Issues page  
**Documentation**: See `/documentation/` folder for detailed technical docs  
**Support**: Community support via GitHub Discussions