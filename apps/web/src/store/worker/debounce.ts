// Runs work once things go quiet, but never later than a maximum wait after it was first
// asked for, so a steady stream of requests still gets served.

export interface Timers {
  readonly now: () => number;
  readonly set: (run: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

const systemTimers: Timers = {
  now: () => performance.now(),
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface Debounced {
  /** Asks for a run `wait` ms from now, or sooner if the maximum wait runs out first. */
  schedule(): void;
  cancel(): void;
}

export function debounce(
  run: () => void,
  wait: number,
  maxWait: number,
  timers: Timers = systemTimers,
): Debounced {
  let handle: unknown;
  let firstAsked: number | undefined;
  const fire = () => {
    handle = undefined;
    firstAsked = undefined;
    run();
  };
  return {
    schedule() {
      const now = timers.now();
      firstAsked ??= now;
      if (handle !== undefined) timers.clear(handle);
      handle = timers.set(fire, Math.max(0, Math.min(wait, firstAsked + maxWait - now)));
    },
    cancel() {
      if (handle !== undefined) timers.clear(handle);
      handle = undefined;
      firstAsked = undefined;
    },
  };
}
