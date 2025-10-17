MELCloud Heat Pump Optimizer

This app makes your Mitsubishi Electric heat pump smarter by automatically adjusting its operation to save money on electricity. It runs on Homey Pro and uses MELCloud data combined with real-time electricity prices to make intelligent decisions about when and how your heat pump should operate.

WHAT IT DOES:

The optimizer continuously monitors electricity prices and weather forecasts to make your heat pump as cost-effective as possible. When electricity is cheap, it will increase heating output and prepare hot water. When prices are high, it scales back operation while maintaining your comfort requirements.

Key capabilities include:
- Smart heating that adjusts temperature targets based on electricity prices
- Hot water optimization that schedules tank heating during low-price periods
- Weather awareness that prepares your home for incoming temperature changes
- Self-learning thermal model that improves efficiency as it gathers data about your home
- Holiday mode integration that reduces heating when you're away
- Legionella protection that ensures safe hot water temperatures

Once configured, the app operates automatically in the background without requiring daily attention. It learns your home's thermal characteristics and becomes more effective over time.

REQUIREMENTS:

To use this app you need:
- Homey Pro device (2019 or later)
- Mitsubishi Electric heat pump connected through MELCloud
- MELCloud account (same login as the official MELCloud app)
- Either a Tibber account with API access OR use the free ENTSO-E price data

The app works with most Mitsubishi Electric heat pumps that support MELCloud connectivity, including air-to-water and ground source models.

SETUP GUIDE:

1. INSTALL AND CONFIGURE MELCLOUD:
   Install the app on your Homey and open the settings page. Enter your MELCloud credentials using the same email address and password that you use in the official MELCloud app. The app will automatically discover your heat pump devices.

2. CHOOSE YOUR ELECTRICITY PRICE SOURCE:
   You have two options for getting electricity price data:

   TIBBER (Recommended for existing Tibber customers):
   - Sign up at tibber.com if you don't have an account
   - Go to Settings > Developer in the Tibber app or website
   - Generate a new API token and copy it
   - Enter the token in the app settings
   - Tibber provides real-time consumer prices including all taxes and fees

   ENTSO-E (Free option for European users):
   - No registration or API token required
   - Simply select your bidding zone/price area from the dropdown
   - Choose your local currency if different from EUR
   - Enable consumer price markup for realistic pricing

3. CONFIGURE CONSUMER PRICING (ENTSO-E users only):
   ENTSO-E provides wholesale market prices, but you pay consumer prices that include taxes, grid fees, and retailer markup. Enable "Convert Wholesale to Consumer Prices" to get realistic pricing.

   The app includes pre-configured settings for 22 European countries with typical:
   - Grid connection fees
   - Energy taxes
   - Retailer markup
   - VAT rates

   You can customize these values if you know your specific rates, or use the defaults which represent typical consumer pricing in your country.

4. SET LOCATION AND WEATHER:
   Enter your home location (city or postal code) so the app can access accurate weather forecasts. This helps the optimizer prepare for temperature changes and adjust heating schedules accordingly.

5. CONFIGURE OPTIMIZATION SETTINGS:
   For maximum savings, consider these settings:
   - Allow 1-2 degrees temperature flexibility during price optimization
   - Enable smart hot water heating to shift energy use to cheap periods
   - Keep learning mode enabled so the app improves over time
   - Enable weather preparation to pre-heat before cold periods
   - Set appropriate comfort hours when you want stable temperatures

PRICE SOURCE COMPARISON:

TIBBER:
- Real-time consumer prices that match your electricity bill
- Includes all taxes, fees, and grid charges automatically
- Updates hourly with next-day prices available in afternoon
- Requires Tibber as your electricity provider (available in Nordic countries and Germany)
- No additional configuration needed for realistic pricing

ENTSO-E:
- Free access to European wholesale electricity markets (no registration required)
- Works in any European country regardless of your electricity provider
- Covers 33+ major European markets with hourly price data
- Requires consumer markup configuration to convert wholesale to retail prices
- Updates hourly with next-day prices available around 1 PM
- Good option if Tibber is not available in your area

GETTING STARTED:

Start with conservative comfort settings and gradually relax them as you become comfortable with how the app works. Monitor the first week closely to understand how the optimizer adapts to your home's characteristics and your daily routines.

The app learns your home's thermal behavior over time, so savings typically improve after the first few weeks of operation. Most households report heating cost reductions of 15-30% depending on local price volatility and how much temperature flexibility they allow.

During the learning period, the app builds a thermal model of your home by observing how quickly it heats up and cools down under different conditions. This model becomes more accurate with time and weather variations.

TROUBLESHOOTING:

If the app seems too aggressive with temperature changes, reduce the allowed temperature flexibility or adjust the comfort hours. If you're not seeing expected savings, check that price data is updating regularly and that the heat pump is responding to optimization commands.

The app includes detailed logging that can help diagnose issues. Check the Homey app logs if you experience connectivity problems with MELCloud or price services.

SUPPORTED COUNTRIES FOR ENTSO-E CONSUMER MARKUP:
Austria, Belgium, Czech Republic, Denmark, Estonia, Finland, France, Germany, Hungary, Italy, Latvia, Lithuania, Netherlands, Norway, Poland, Portugal, Slovakia, Slovenia, Spain, Sweden, Switzerland, United Kingdom.

For technical support, feature requests, or to report issues, visit the project page at https://github.com/decline27/melcloud-optimizer.
