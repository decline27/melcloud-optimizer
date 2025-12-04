# Consumer Markup Configuration for ENTSO-E

This feature allows you to convert ENTSO-E wholesale electricity prices to approximate consumer prices by adding typical residential electricity costs.

## Overview

ENTSO-E provides wholesale market prices, but consumers pay additional costs:
- **Grid fees** - Distribution and transmission costs  
- **Energy taxes** - Government taxes on electricity consumption
- **Retail markup** - Energy supplier profit margin
- **VAT** - Value-added tax (varies by country)

## Configuration Format

The consumer markup configuration is stored as JSON in the ENTSO-E settings:

```json
{
  "SE": {
    "gridFee": 0.030,
    "energyTax": 0.036,
    "retailMarkup": 0.010,
    "vatRate": 1.25,
    "description": "Sweden - typical residential"
  },
  "DE": {
    "gridFee": 0.070,
    "energyTax": 0.025,
    "retailMarkup": 0.015,
    "vatRate": 1.19,
    "description": "Germany - typical residential"
  },
  "default": {
    "gridFee": 0.040,
    "energyTax": 0.020,
    "retailMarkup": 0.010,
    "vatRate": 1.20,
    "description": "EU average approximation"
  }
}
```

## Settings Explanation

### Country Detection
The system automatically detects the country from your ENTSO-E area setting:
- `SE3` or `10Y1001A1001A46L` → uses "SE" configuration
- `DE` or `10Y1001A1001A83F` → uses "DE" configuration
- Unknown areas → uses "default" configuration

### Price Components (per kWh)
- **`gridFee`** - Distribution network costs
- **`energyTax`** - Government energy/electricity tax  
- **`retailMarkup`** - Energy supplier margin
- **`vatRate`** - VAT multiplier (1.25 = 25% VAT)

### Currency Units
Choose the currency for markup values:
- **Local Currency** - Values in your local currency (SEK, EUR, etc.)
- **Euro (EUR)** - Values in EUR, converted automatically

## Calculation Formula

```
Consumer Price = (Wholesale + GridFee + EnergyTax + RetailMarkup) × VATRate
```

Example for Sweden:
- Wholesale: 0.00022 SEK/kWh (from ENTSO-E)
- Grid fee: 0.030 SEK/kWh
- Energy tax: 0.036 SEK/kWh  
- Retail markup: 0.010 SEK/kWh
- Subtotal: 0.07622 SEK/kWh
- With 25% VAT: 0.095 SEK/kWh

## Country-Specific Examples

### Major European Markets (Pre-configured)

The system includes realistic consumer markup data for **22 major European markets**:

#### Nordic Countries
- **🇸🇪 Sweden (SE)**: Grid 0.030 + Tax 0.036 + Markup 0.010 × VAT 1.25
- **🇳🇴 Norway (NO)**: Grid 0.035 + Tax 0.017 + Markup 0.008 × VAT 1.25  
- **🇩🇰 Denmark (DK)**: Grid 0.045 + Tax 0.089 + Markup 0.012 × VAT 1.25
- **🇫🇮 Finland (FI)**: Grid 0.042 + Tax 0.027 + Markup 0.015 × VAT 1.24

#### Western Europe
- **🇩🇪 Germany (DE)**: Grid 0.070 + Tax 0.025 + Markup 0.015 × VAT 1.19
- **🇫🇷 France (FR)**: Grid 0.045 + Tax 0.022 + Markup 0.012 × VAT 1.20
- **🇳🇱 Netherlands (NL)**: Grid 0.055 + Tax 0.030 + Markup 0.018 × VAT 1.21
- **🇧🇪 Belgium (BE)**: Grid 0.048 + Tax 0.028 + Markup 0.015 × VAT 1.21
- **🇦🇹 Austria (AT)**: Grid 0.038 + Tax 0.015 + Markup 0.012 × VAT 1.20
- **🇨🇭 Switzerland (CH)**: Grid 0.065 + Tax 0.023 + Markup 0.020 × VAT 1.077
- **🇬🇧 United Kingdom (GB)**: Grid 0.050 + Tax 0.006 + Markup 0.020 × VAT 1.05

#### Southern Europe  
- **🇮🇹 Italy (IT)**: Grid 0.055 + Tax 0.035 + Markup 0.018 × VAT 1.22
- **🇪🇸 Spain (ES)**: Grid 0.045 + Tax 0.051 + Markup 0.015 × VAT 1.21
- **🇵🇹 Portugal (PT)**: Grid 0.042 + Tax 0.034 + Markup 0.013 × VAT 1.23

#### Central & Eastern Europe
- **🇵🇱 Poland (PL)**: Grid 0.025 + Tax 0.012 + Markup 0.008 × VAT 1.23
- **🇨🇿 Czech Republic (CZ)**: Grid 0.030 + Tax 0.018 + Markup 0.010 × VAT 1.21
- **🇸🇰 Slovakia (SK)**: Grid 0.028 + Tax 0.015 + Markup 0.009 × VAT 1.20
- **🇸🇮 Slovenia (SI)**: Grid 0.045 + Tax 0.030 + Markup 0.012 × VAT 1.22
- **🇭🇺 Hungary (HU)**: Grid 0.022 + Tax 0.008 + Markup 0.007 × VAT 1.27

#### Baltic States
- **🇪🇪 Estonia (EE)**: Grid 0.035 + Tax 0.007 + Markup 0.012 × VAT 1.20
- **🇱🇻 Latvia (LV)**: Grid 0.038 + Tax 0.009 + Markup 0.014 × VAT 1.21
- **🇱🇹 Lithuania (LT)**: Grid 0.040 + Tax 0.011 + Markup 0.016 × VAT 1.21

## Usage

1. **Enable Consumer Markup** - Check the box in ENTSO-E settings
2. **Configure Countries** - Edit the JSON configuration for your markets
3. **Set Currency** - Choose if markup values are in local currency or EUR
4. **Test** - Run optimization and check logs for "with consumer markup" message

## Validation

The system will log when consumer markup is applied:
```
[ENTSO-E] Loaded 48 hourly prices, current 0.0952 SEK/kWh (with consumer markup)
ENTSO-E consumer markup applied for country: SE
```

## Limitations

- Values are approximations based on typical residential rates
- Actual consumer prices vary by supplier, region, and contract type
- Grid fees and taxes change over time
- Some markets have time-of-use or demand-based pricing not reflected here

For most accurate consumer prices, consider using Tibber (where available) or aWATTar (Austria/Germany) APIs instead.