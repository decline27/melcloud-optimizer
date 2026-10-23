import { describe, expect, test } from '@jest/globals';
import { isRoomTargetMode, describeZoneMode, getZoneOperationalState, ZoneOperationMode } from '../../src/util/zone-mode';

describe('isRoomTargetMode', () => {
  test('Room mode (0) yields a genuine room target', () => {
    expect(isRoomTargetMode(ZoneOperationMode.Room)).toBe(true);
  });

  test('Flow mode (1) does not yield a room target', () => {
    expect(isRoomTargetMode(ZoneOperationMode.Flow)).toBe(false);
  });

  // Regression: this device runs in Curve mode and reported a "room target" of 29 °C,
  // which the thermal analyser consumed as (29 - indoor) and learned a negative heating rate from.
  test('Curve mode (2) does not yield a room target', () => {
    expect(isRoomTargetMode(ZoneOperationMode.Curve)).toBe(false);
  });

  test('unreported mode is treated as Room to preserve legacy/ATA behaviour', () => {
    expect(isRoomTargetMode(undefined)).toBe(true);
    expect(isRoomTargetMode(null)).toBe(true);
  });

  test('unknown modes are not assumed to be room targets', () => {
    expect(isRoomTargetMode(3)).toBe(false);
    expect(isRoomTargetMode(4)).toBe(false);
  });
});

describe('describeZoneMode', () => {
  test.each([
    [ZoneOperationMode.Room, 'room'],
    [ZoneOperationMode.Flow, 'flow'],
    [ZoneOperationMode.Curve, 'curve']
  ])('describes mode %s as %s', (mode, expected) => {
    expect(describeZoneMode(mode)).toBe(expected);
  });

  test('describes missing and unknown modes distinctly', () => {
    expect(describeZoneMode(undefined)).toBe('unreported');
    expect(describeZoneMode(null)).toBe('unreported');
    expect(describeZoneMode(9)).toBe('unknown(9)');
  });
});

describe('getZoneOperationalState', () => {
  // Regression: Device/Get has no Zone1InHeatMode, so zone 1 read idle while the unit was
  // heating (live 2026-10-23: OperationMode 2, Curve mode, 474 W, flow 33.5 C).
  test('Curve-mode zone reads heating while the unit space-heats, without Zone1InHeatMode', () => {
    expect(getZoneOperationalState({ OperationMode: 2, OperationModeZone1: ZoneOperationMode.Curve, IdleZone1: false }, 'Zone1'))
      .toBe('heating');
  });

  test('zone reads idle when its thermostat is satisfied', () => {
    expect(getZoneOperationalState({ OperationMode: 2, OperationModeZone1: ZoneOperationMode.Curve, IdleZone1: true }, 'Zone1'))
      .toBe('idle');
  });

  test('zone reads idle during a hot-water run', () => {
    expect(getZoneOperationalState({ OperationMode: 1, OperationModeZone1: ZoneOperationMode.Curve, IdleZone1: false }, 'Zone1'))
      .toBe('idle');
  });

  test('zone reads idle when the unit is idle', () => {
    expect(getZoneOperationalState({ OperationMode: 0, OperationModeZone1: ZoneOperationMode.Room, IdleZone1: false }, 'Zone1'))
      .toBe('idle');
  });

  test('explicit Zone1InHeatMode still wins when the API sends it', () => {
    expect(getZoneOperationalState({ OperationMode: 2, OperationModeZone1: ZoneOperationMode.Curve, Zone1InHeatMode: false, IdleZone1: false }, 'Zone1'))
      .toBe('idle');
  });

  test('cooling, defrost and prohibited states', () => {
    expect(getZoneOperationalState({ OperationMode: 3, IdleZone1: false }, 'Zone1')).toBe('cooling');
    expect(getZoneOperationalState({ OperationMode: 2, OperationModeZone1: 2, IdleZone1: false, DefrostMode: 1 }, 'Zone1')).toBe('defrost');
    expect(getZoneOperationalState({ OperationMode: 2, OperationModeZone1: 2, IdleZone1: false, ProhibitHeatingZone1: true }, 'Zone1')).toBe('prohibited');
  });

  test('zone 2 reads its own fields', () => {
    const state = { OperationMode: 2, OperationModeZone1: 2, OperationModeZone2: 0, IdleZone1: false, IdleZone2: true };
    expect(getZoneOperationalState(state, 'Zone1')).toBe('heating');
    expect(getZoneOperationalState(state, 'Zone2')).toBe('idle');
  });
});
