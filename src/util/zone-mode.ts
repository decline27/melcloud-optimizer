/**
 * Zone control-mode helpers for Mitsubishi ATW (air-to-water) devices.
 *
 * MELCloud reports the zone control mode in `OperationModeZone1` / `OperationModeZone2`.
 * The meaning of the zone setpoint depends entirely on this mode:
 *
 *  - 0 Room   — the unit modulates flow temperature to reach `SetTemperatureZoneN`.
 *  - 1 Flow   — the unit holds a fixed flow temperature (`SetHeatFlowTemperatureZoneN`).
 *  - 2 Curve  — the unit follows its weather-compensation curve for flow temperature.
 *
 * `SetTemperatureZoneN` is a room temperature in every mode. With a room sensor fitted it acts as
 * a thermostat even in Curve mode: room at or above the setpoint means thermo-off, below means
 * the curve runs (measured live 2026-10-13: a raise above the room switched an idle unit to
 * heating within one poll). What Curve mode removes is *power*: a higher setpoint cannot make
 * the curve deliver more heat, so (target - indoor) says whether heat flows, not how fast. Any
 * model that learns a heating rate from that difference is only valid in Room mode.
 *
 * (The nonsense 29 °C "room target" seen in August came from reading the ATA-shaped
 * `SetTemperature` field, not from the zone mode.)
 */

export enum ZoneOperationMode {
  Room = 0,
  Flow = 1,
  Curve = 2
}

/**
 * True when the zone setpoint can be interpreted as a room-temperature target.
 *
 * Devices that do not report the field (ATA units, older firmware) return `undefined`,
 * which is treated as Room mode to preserve existing behaviour.
 */
export function isRoomTargetMode(operationMode: number | undefined | null): boolean {
  if (operationMode === undefined || operationMode === null) {
    return true;
  }
  return operationMode === ZoneOperationMode.Room;
}

/** Human-readable zone mode name for logs and diagnostics. */
export function describeZoneMode(operationMode: number | undefined | null): string {
  switch (operationMode) {
    case ZoneOperationMode.Room:
      return 'room';
    case ZoneOperationMode.Flow:
      return 'flow';
    case ZoneOperationMode.Curve:
      return 'curve';
    case undefined:
    case null:
      return 'unreported';
    default:
      return `unknown(${operationMode})`;
  }
}
