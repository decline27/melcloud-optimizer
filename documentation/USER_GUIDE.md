# MELCloud Optimizer - User Guide

Welcome to the MELCloud Optimizer! This guide explains how the system works, how it saves you money, and how to configure it for your needs.

## 🌟 What is MELCloud Optimizer?

MELCloud Optimizer is a smart add-on for your Mitsubishi Electric heat pump. It connects your heat pump (via MELCloud) with real-time electricity prices (via Tibber or Entsoe) to automatically manage your heating and hot water.

**The Goal:** Maintain your comfort while minimizing costs.

It achieves this by:
1.  **Pre-heating** your home when electricity is cheap.
2.  **Coasting** (reducing heating) when electricity is expensive.
3.  **Smart Tank Management** to heat hot water during the cheapest hours of the day.

---

## 🧠 How It Works (The "Magic")

The system runs a continuous optimization cycle (typically every hour) that follows these steps:

1.  **Gather Data:**
    *   **Current Prices:** Checks the current electricity price and the forecast for the next 24 hours.
    *   **Indoor Climate:** Reads the current temperature in your home.
    *   **Outdoor Weather:** Checks the outside temperature to understand heating demand.
    *   **Device State:** Sees what your heat pump is currently doing.

2.  **Analyze & Decide:**
    *   It classifies the current price as **Very Cheap**, **Cheap**, **Normal**, **Expensive**, or **Very Expensive** compared to the daily average.
    *   It calculates a "Planning Bias" – a temperature adjustment based on future prices. If prices are about to jump up, it might pre-heat now.

3.  **Apply Changes:**
    *   It sends new target temperatures for your Heating Zones and Hot Water Tank to the heat pump.

---

## 🌡️ Features in Detail

### 1. Smart Heating (Zone 1)
Zone 1 is your primary heating zone (e.g., radiators or underfloor heating).

*   **Comfort Band:** You define a minimum and maximum acceptable temperature (e.g., 20°C - 23°C). The optimizer *never* goes outside these limits.
*   **Price Sensitivity:**
    *   **Cheap Prices:** The target temperature moves towards your maximum (e.g., 23°C) to store heat in the house structure.
    *   **Expensive Prices:** The target temperature moves towards your minimum (e.g., 20°C) to save energy, relying on the stored heat.
*   **Adaptive Learning:** The system learns how fast your home heats up and cools down (Thermal Inertia) to make better decisions.

### 2. Secondary Zone (Zone 2)
If you have a second heating zone (e.g., upstairs or bedrooms), the optimizer manages it too.

*   **Coordinated Control:** Zone 2 follows the strategy of Zone 1 but adapts to its own current temperature.
*   **Independent Constraints:** You can set different min/max temperatures for Zone 2.
*   **Smart Fallback:** If price data is ever missing, Zone 2 safely defaults to a standard setting to ensure you don't freeze.

### 3. Smart Hot Water (Tank)
Heating water takes a lot of energy. The optimizer ensures this happens efficiently.

*   **Pattern Recognition:** It learns when you typically use hot water (e.g., morning showers).
*   **Strategic Heating:** It schedules tank heating for the absolute cheapest hours of the day, ensuring the tank is hot *before* you need it.
*   **Price Levels:**
    *   **Very Cheap:** Heats tank to max (pre-loading energy).
    *   **Expensive:** Lowers target to minimum (just enough to maintain safety).

### 4. Safety & Reliability
*   **Freeze Protection:** If the indoor temperature drops too low, the system overrides everything to protect your home.
*   **Anti-Cycling:** It prevents the heat pump from turning on and off too frequently (short-cycling), which protects the compressor.
*   **Connection Issues:** If the internet goes down or MELCloud is unreachable, the system has "safe mode" fallbacks to keep your heating running normally.

---

## ⚙️ Key Settings Explained

You can configure these settings in the Homey app:

| Setting | Description | Recommended |
| :--- | :--- | :--- |
| **Comfort Min Temp** | The lowest temperature you tolerate. | 19°C - 20°C |
| **Comfort Max Temp** | The highest temperature you tolerate. | 22°C - 24°C |
| **Price Area** | Your electricity price zone (e.g., NO1, SE3). | Your Region |
| **Zone 2 Enabled** | Turn on if you have a second heating zone. | On/Off |
| **Tank Optimization** | Enable smart hot water management. | On |
| **Sensitivity** | How aggressively it reacts to price changes. | Normal |

---

## 📊 Understanding Your Dashboard

*   **COP (Coefficient of Performance):** Measures efficiency. A COP of 3.5 means for every 1 kWh of electricity, you get 3.5 kWh of heat. Higher is better!
*   **Savings:** The estimated money saved compared to a "dumb" thermostat that keeps a constant temperature.
*   **Optimization State:** Shows what the system is currently doing (e.g., "Pre-heating", "Conserving").

---

## ❓ FAQ & Troubleshooting

**Q: My house feels too cold in the morning.**
A: Check your **Comfort Min Temp**. You might also want to increase the **Sensitivity** setting so the system pre-heats more aggressively before the morning price peak.

**Q: The app says "Price Data Missing".**
A: Don't worry. The system enters a "Safe Mode" and acts like a normal thermostat until price data returns.

**Q: Why is the target temperature higher than I set?**
A: Electricity is likely cheap right now! The system is "banking" heat so it can use less energy later when prices rise.

**Q: I changed a setting manually on the wall controller. Will the optimizer overwrite it?**
A: Yes, on the next cycle (usually within an hour). The optimizer is designed to be the "master" controller. Use the Homey app to change your comfort preferences instead.
