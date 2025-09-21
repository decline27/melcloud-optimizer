# MELCloud Heat Pump Optimizer

This app makes your Mitsubishi Electric heat pump smarter by automatically adjusting its operation to save you money on electricity bills.

## What it does
- **Smart heating**: Heats your home more when electricity is cheap, less when it's expensive
- **Hot water optimization**: Efficiently manages your hot water tank heating schedule
- **Weather awareness**: Adjusts operation based on outdoor temperature and weather forecasts
- **Self-learning**: Gets better over time by learning how your home heats and cools
- **Background operation**: Runs automatically once set up - no daily interaction needed

## How it works
The app connects to your heat pump through MELCloud and monitors real-time electricity prices. It then intelligently adjusts your heat pump's target temperature to take advantage of cheaper electricity while maintaining your comfort.

## What you need
- Homey Pro device
- Mitsubishi Electric heat pump with MELCloud connection
- MELCloud account (free from Mitsubishi Electric)
- Tibber electricity account with API access

## Installation
Simply install this app on your Homey, enter your MELCloud and Tibber credentials, and let it optimize your heating automatically.

## Setup Guide

### Required Settings:
1. **MELCloud Credentials**
   - Username: Your MELCloud email address
   - Password: Your MELCloud password
   - (These are the same credentials you use for the MELCloud app)

2. **Tibber API Token**
   - Log into your Tibber account at tibber.com
   - Go to Settings → Developer → Create API token
   - Copy the token into the app settings

3. **Location Settings**
   - Set your home's location for accurate weather data
   - This helps the app predict heating needs based on outdoor temperature

### Optional Settings for Maximum Savings:
- **Temperature flexibility**: Allow 1-2°C variation from your normal temperature
- **Hot water scheduling**: Enable smart hot water heating during cheap price hours
- **Weather integration**: Let the app pre-heat before cold weather arrives
- **Learning mode**: Keep enabled so the app learns your home's heating patterns

### Tips to Maximize Savings:
- Start with conservative settings and gradually increase flexibility
- Monitor your first week to see how the app adapts to your home
- The app saves more money during winter months when heating costs are higher
- Savings typically range from 15-30% on heating costs

For support and detailed information: https://github.com/decline27/melcloud-optimizer
