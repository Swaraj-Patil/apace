// Frame intervals during a scroll. The probe only collects them; the bench snaps them to whole
// refresh periods and takes the worst view's p95.

export interface FrameSampler {
  /** Stops sampling and returns the gaps between painted frames, in milliseconds. */
  stop(): number[];
}

export function sampleFrames(): FrameSampler {
  const times: number[] = [];
  let running = true;
  const tick = (time: number) => {
    times.push(time);
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return {
    stop() {
      running = false;
      return times.slice(1).map((time, index) => time - (times[index] ?? time));
    },
  };
}
