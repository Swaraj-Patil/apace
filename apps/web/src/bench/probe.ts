// Bench builds only: a page of synthetic work with known costs, so the probes can be checked
// against numbers nobody has to infer. It drives the same probes the app drives, and the
// handlers are shaped the way the app's are: measure first, then do the work, then paint.
import { measureKeystroke, measureToPaint, sampleFrames, takeSamples } from '../perf/index.ts';

/** Burns main-thread time, the way a slow handler would. */
function busyWait(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // Spinning is the point: this is work the probe has to count.
  }
}

interface StallRun {
  /** The gaps between painted frames. */
  readonly intervals: number[];
  /** How many times the loop stalled. */
  readonly stalls: number;
}

interface ProbePage {
  /** How long the next key handler busies the main thread before painting. */
  keyCosts(ms: number): void;
  /** How long the next click holds its paint back. */
  clickCosts(ms: number): void;
  /** Queues work before the next frame, through a timer or a message task. */
  queueWork(kind: 'timeout' | 'message', busyMs: number): void;
  /** Paints frames for `ms`, stalling for `stallMs` every `everyFrames` frames. */
  stallScroll(ms: number, stallMs: number, everyFrames: number): Promise<StallRun>;
  samples: typeof takeSamples;
}

declare global {
  interface Window {
    __probe?: ProbePage;
  }
}

const field = document.createElement('input');
field.id = 'field';
field.type = 'text';
const button = document.createElement('button');
button.id = 'button';
button.type = 'button';
button.textContent = 'Click';
const box = document.createElement('div');
box.id = 'box';
box.textContent = 'idle';
document.body.append(field, button, box);

let keyBusyMs = 0;
let clickBusyMs = 0;
let painted = 0;

/** What the box will say once this interaction is painted. */
const nextText = () => `painted ${painted + 1}`;

function finish(): void {
  painted++;
  box.textContent = `painted ${painted}`;
}

field.addEventListener('keydown', (event) => {
  const expected = nextText();
  measureKeystroke(event, { settled: () => box.textContent === expected });
  busyWait(keyBusyMs);
  finish();
});

button.addEventListener('click', (event) => {
  const expected = nextText();
  measureToPaint('page-open', event.timeStamp, { settled: () => box.textContent === expected });
  busyWait(clickBusyMs);
  finish();
});

window.__probe = {
  keyCosts(ms) {
    keyBusyMs = ms;
  },
  clickCosts(ms) {
    clickBusyMs = ms;
  },
  queueWork(kind, busyMs) {
    if (kind === 'timeout') {
      setTimeout(() => busyWait(busyMs), 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      busyWait(busyMs);
    };
    channel.port2.postMessage(0);
  },
  async stallScroll(ms, stallMs, everyFrames) {
    const sampler = sampleFrames();
    let frames = 0;
    let stalls = 0;
    await new Promise<void>((done) => {
      const until = performance.now() + ms;
      const tick = () => {
        frames++;
        if (everyFrames > 0 && frames % everyFrames === 0) {
          stalls++;
          busyWait(stallMs);
        }
        box.textContent = `frame ${frames}`;
        if (performance.now() < until) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    // The last stall may land after the final frame, so it never shows as an interval.
    return { intervals: sampler.stop(), stalls };
  },
  samples: takeSamples,
};
