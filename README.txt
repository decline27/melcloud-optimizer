MELCloud Heat Pump Optimizer

This app makes your Mitsubishi Electric heat pump smarter by automatically adjusting its operation to save money on electricity. It runs on Homey Pro and uses both MELCloud data and Tibber prices to decide how and when the heat pump should run.

Key capabilities include smart heating that increases output when electricity is cheap and scales back when prices are high, hot water optimization that aligns tank heating with favorable price windows, weather awareness that reacts to outdoor temperature forecasts, and a self-learning model that improves as it gathers more data. Once configured, the app operates in the background without daily attention.

To use the app you need a Homey Pro device, a Mitsubishi Electric heat pump connected through MELCloud, a MELCloud account, and a Tibber account with API access.

Install the app on your Homey, open the settings, and enter your MELCloud and Tibber credentials. The same MELCloud email address and password that you use in the official MELCloud app are required. The Tibber API token is created from the Tibber website by opening Settings, then Developer, and generating a new token.

Provide your home location so the app can match heating decisions with the expected weather. For the best savings you can allow a small temperature flexibility window, enable smart hot water heating, keep learning mode enabled, and let the app prepare for incoming cold weather.

Start with conservative comfort settings and relax them once you see the savings. Monitor the first week to understand how the app adapts to your home. Most households report noticeably lower heating costs in winter, typically between fifteen and thirty percent depending on price spreads and comfort targets.

If you need help or want to report an issue, visit https://github.com/decline27/melcloud-optimizer.
