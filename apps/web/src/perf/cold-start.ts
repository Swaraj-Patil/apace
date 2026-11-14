// Cold start: from navigation start to the painted frame where the shell is interactive.
//
// "Interactive" is the whole shell, not the first paint, so every part of it registers here
// and reports when it's ready. As the app grows a sidebar, a command bar and a restored page,
// each registers its own part and the measurement gets stricter rather than staying the same.
import { measureToPaint } from './paint.ts';

/** The parts of the shell that must be ready. Later steps add their own. */
export const SHELL_PARTS = ['store', 'shell'] as const;
export type ShellPart = (typeof SHELL_PARTS)[number];

const waiting = new Set<string>(SHELL_PARTS);
let measured = false;

/**
 * Reports that one part of the shell is ready. The measurement ends at the first frame painted
 * after the last part reports in. Calling it twice changes nothing.
 */
export function shellReady(part: ShellPart): void {
  if (measured || !waiting.delete(part)) return;
  if (waiting.size > 0) return;
  measured = true;
  // The page's clock starts at navigation, so zero is where the span starts.
  measureToPaint('cold-start', 0, { detail: { parts: SHELL_PARTS.length } });
}

/** The parts that haven't reported yet. The bench reads it when a run times out. */
export function shellPending(): string[] {
  return [...waiting];
}
