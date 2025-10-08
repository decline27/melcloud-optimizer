# Staging Rollout Checklist (Optimizer Structured Logs)

1. **Build & deploy**
   - `npm run build`
   - `homey app install --run --debug --device <STAGING_HOMEY_ID>`
   - Confirm the app reports `App: [App] Logger initialized ...` in the CLI.

2. **Enable structured log capture**
   - In a second terminal run `homey app run --debug | grep 'optimizer.'` to filter JSON entries.
   - Ensure every hourly run emits:
     - `optimizer.run.start`
     - `constraints.zone1.initial` + `constraints.zone1.final`
     - One of `optimizer.setpoint.applied | optimizer.setpoint.error | optimizer.setpoint.hold | optimizer.setpoint.skipped`

3. **Monitor guardrails (first 24h)**
   - **Lockout/duplicate holds**: count of `optimizer.setpoint.hold` with reason containing `lockout` or `duplicate` should stay < 5 per day.
   - **MELCloud errors**: if `optimizer.setpoint.error` appears, note the `error` field and re-run after checking credentials.
   - **Latency**: `latencyMs` in `optimizer.setpoint.applied` should stay < 2000 ms; spikes imply network/API slowness.

4. **Comfort & cost trend**
   - Export Homey Insights for indoor temp and setpoint to confirm RMS deviation < 0.5 °C.
   - Compare daily cost impact (Homey settings `orchestrator_metrics.dailyCostImpact`) with baseline before enabling the constraints helper.

5. **Rollback**
   - `homey app uninstall com.melcloud.optimize`
   - Reinstall previous stable build from tag `vX.Y.Z`.
