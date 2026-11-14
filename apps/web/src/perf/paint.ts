// When a frame reaches the screen, and how much of the wait for it was work.
//
// A requestAnimationFrame callback runs just before the browser renders, and a MessageChannel
// message posted from it runs in the next task, after that frame is painted. So the message's
// own timestamp is the end of the painted frame.
//
// Alongside that, the probe keeps a chain of MessageChannel messages going. Each hop is a
// task, so anything else with work to do, such as React, a timer or the Yjs binding, runs
// between two hops and shows up as a gap. A gap too small to hold any work is the chain
// running on its own: that is idle time, and the span records it separately. Whether idle time
// counts is the metric's business, not the probe's.
import { record } from './samples.ts';

/**
 * A gap no longer than this is the chain spinning by itself. A hop costs well under a tenth of
 * a millisecond, so anything above this ran something. On a machine slow enough for a hop to
 * take longer, the gap counts as work, which overstates a sample rather than hiding it.
 */
export const IDLE_HOP_MS = 1;

/** Calls `done` with the end of the next painted frame. */
export function afterNextPaint(done: (end: number) => void): void {
  requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      done(performance.now());
    };
    channel.port2.postMessage(0);
  });
}

export interface Span {
  /** When the frame that finished the span was painted. */
  readonly end: number;
  /** How much of the time since the span was opened went on nothing at all. */
  readonly idleMs: number;
  /** How many frames were painted before `settled` held. */
  readonly frames: number;
}

/**
 * Watches until the first painted frame where `settled` holds, and reports when that was and
 * how much of the wait was idle. The browser can paint before the change the caller is waiting
 * for lands, so the probe follows it to the frame that has it.
 */
export function spanToPaint(settled: () => boolean, done: (span: Span) => void): void {
  const channel = new MessageChannel();
  let last = performance.now();
  let idleMs = 0;
  let spinning = true;
  let frames = 0;

  channel.port1.onmessage = () => {
    const now = performance.now();
    if (now - last <= IDLE_HOP_MS) idleMs += now - last;
    last = now;
    if (spinning) channel.port2.postMessage(0);
    else channel.port1.close();
  };
  channel.port2.postMessage(0);

  const check = () => {
    afterNextPaint((end) => {
      frames++;
      if (!settled()) {
        check();
        return;
      }
      spinning = false;
      done({ end, idleMs, frames });
    });
  };
  check();
}

/**
 * Measures from `start` to the end of the first painted frame where `settled` holds. The
 * sample keeps the whole span, including any wait for the next refresh, and records how much
 * of it was idle.
 */
export function measureToPaint(
  name: string,
  start: number,
  options: { settled?: () => boolean; detail?: Readonly<Record<string, unknown>> } = {},
): void {
  spanToPaint(options.settled ?? (() => true), ({ end, idleMs, frames }) => {
    record({ name, start, end, idleMs, detail: { frames, ...options.detail } });
  });
}
