// Every probe writes here. The app records samples in all builds, so the bench measures the
// same code production runs; only the hooks that read them back are bench-only.

export interface Sample {
  /** What was measured: `cold-start`, `page-open`, `keystroke`, `quick-search`. */
  readonly name: string;
  /** When the span started, on the page's clock. */
  readonly start: number;
  /** When the frame that finished it was painted. */
  readonly end: number;
  /** Time inside the span when no work ran, such as waiting for the next refresh. */
  readonly idleMs: number;
  /** Whatever else the probe knows, for the report and for traces. */
  readonly detail?: Readonly<Record<string, unknown>>;
}

const taken: Sample[] = [];

/** Records a sample, and marks it in the timeline so traces show it too. */
export function record(sample: Sample): void {
  taken.push(sample);
  try {
    performance.measure(sample.name, {
      start: sample.start,
      end: sample.end,
      detail: { idleMs: sample.idleMs, ...sample.detail },
    });
  } catch {
    // A measure that can't be written changes nothing about the sample itself.
  }
}

/** The samples taken since the last call. The bench reads and clears them per scenario. */
export function takeSamples(): Sample[] {
  return taken.splice(0);
}
