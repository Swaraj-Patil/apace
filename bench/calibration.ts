// A fixed amount of work, timed on every bench run.
//
// Budgets are met or missed on a particular machine. When the numbers move, the first question
// is whether the app changed or the machine did, and the second is how a laptop's numbers
// relate to the runner's. Both need one workload that never changes, timed in the same run as
// the metrics.
//
// The work is integer arithmetic alone. Every operation in it is exact in any JavaScript
// engine, so the checksum is the same on every machine and only the time differs. It measures
// one core's speed at arithmetic, which is what the app's main thread mostly does, and says
// nothing about memory, storage or the GPU.
import { median } from './stats.ts';

/** One round. About 90 ms on an Apple M4. */
export const CALIBRATION_ITERATIONS = 20_000_000;

/**
 * What a round of the standard size returns. The workload is pinned by this number: changing
 * the arithmetic changes it, which fails a test, because runs of two different workloads can't
 * be read against each other.
 */
export const CALIBRATION_CHECKSUM = 3_601_439_112;

/** Enough rounds that one interrupted round doesn't decide the answer. */
export const CALIBRATION_ROUNDS = 5;

/** A xorshift chain, summed. The result is returned so nothing can optimize the loop away. */
export function calibrationRound(iterations = CALIBRATION_ITERATIONS): number {
  let state = 0x9e3779b9 | 0;
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    state = (state ^ (state << 13)) | 0;
    state = (state ^ (state >>> 17)) | 0;
    state = (state ^ (state << 5)) | 0;
    sum = (sum + Math.imul(state ^ i, 0x85ebca6b)) | 0;
  }
  return sum >>> 0;
}

/** The median time of `rounds` rounds, in milliseconds. */
export function calibrate(rounds = CALIBRATION_ROUNDS): number {
  const times: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const started = performance.now();
    const checksum = calibrationRound();
    if (checksum !== CALIBRATION_CHECKSUM) {
      throw new Error(`The calibration workload returned ${checksum}, not the fixed checksum`);
    }
    times.push(performance.now() - started);
  }
  return Number(median(times).toFixed(3));
}
