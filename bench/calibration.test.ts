import { describe, expect, test } from 'vitest';
import {
  CALIBRATION_CHECKSUM,
  CALIBRATION_ITERATIONS,
  calibrate,
  calibrationRound,
} from './calibration.ts';

describe('the calibration workload', () => {
  test('is the same work on every machine', () => {
    expect(calibrationRound()).toBe(CALIBRATION_CHECKSUM);
    expect(calibrationRound()).toBe(calibrationRound());
  });

  test('changes its answer when the amount of work changes', () => {
    expect(calibrationRound(CALIBRATION_ITERATIONS - 1)).not.toBe(CALIBRATION_CHECKSUM);
    expect(calibrationRound(1)).toBe(calibrationRound(1));
  });

  test('times itself, and the time is a real measurement', () => {
    const ms = calibrate(2);
    expect(ms).toBeGreaterThan(0);
    expect(Number.isFinite(ms)).toBe(true);
    // A number in this range on any machine the bench runs on. A wildly different one means
    // the workload, not the machine, changed.
    expect(ms).toBeLessThan(10_000);
  });
});
