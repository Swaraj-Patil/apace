// Keystroke latency: from the key event to the end of the frame that paints it. The budget
// excludes the idle wait for the next refresh, which the span records, so the bench subtracts
// it when it counts the sample.
import { spanToPaint } from './paint.ts';
import { record } from './samples.ts';

/**
 * Measures the keystroke `event` started. It ends at the first painted frame where `settled`
 * holds, so a change that misses the first frame is followed to the frame that has it.
 */
export function measureKeystroke(
  event: { readonly timeStamp: number },
  options: { settled?: () => boolean; detail?: Readonly<Record<string, unknown>> } = {},
): void {
  spanToPaint(options.settled ?? (() => true), ({ end, idleMs, frames }) => {
    record({
      name: 'keystroke',
      start: event.timeStamp,
      end,
      idleMs,
      detail: { frames, ...options.detail },
    });
  });
}
