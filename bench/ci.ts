// What CI should run, and what it should compare against.
//
// Both answers depend on the branch and on what the repository already holds, so they're
// decided here, where they can be tested, rather than in the workflow file. The workflow asks
// once and uses the answers.
//
// Run with: node bench/ci.ts
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const REPO = fileURLToPath(new URL('../', import.meta.url));

/** Where CI looks for main, which is a local branch on some checkouts and a remote on others. */
export const MAIN_REFS = ['main', 'origin/main'] as const;

/** The phase a branch is working on, or null when its name doesn't name one. */
export function phaseOf(branch: string): number | null {
  const found = /^phase-(\d+)$/.exec(branch.trim());
  return found === null ? null : Number(found[1]);
}

/** True when every step in a plan's checklist is ticked. */
export function planComplete(plan: string): boolean {
  const steps = [...plan.matchAll(/^- \[([ x])\] /gm)].map(([, box]) => box);
  return steps.length > 0 && !steps.includes(' ');
}

/**
 * Whether CI runs the gate rather than the five commands. The gate is what says a phase can
 * merge, so it runs once the phase's plan has nothing left unticked.
 */
export function gateWanted(branch: string, plan: string | null): boolean {
  return phaseOf(branch) !== null && plan !== null && planComplete(plan);
}

/** The plan for a branch, or null when the branch has none. */
export async function planFor(branch: string, repo = REPO): Promise<string | null> {
  if (phaseOf(branch) === null) return null;
  try {
    return await readFile(join(repo, 'docs/plan', `${branch}.md`), 'utf8');
  } catch {
    return null;
  }
}

/** The first of `refs` that exists here and already holds the bench harness. */
export async function harnessRef(
  refs: readonly string[],
  file = 'bench/budgets.json',
): Promise<string | null> {
  for (const ref of refs) {
    try {
      await exec('git', ['show', `${ref}:${file}`], { cwd: REPO, maxBuffer: 1024 * 1024 });
      return ref;
    } catch {
      // Either the ref isn't here or it predates the harness. Try the next one.
    }
  }
  return null;
}

/**
 * What `bench:ab` compares against: main once main has the harness, and the commit before this
 * one until then. A base without the harness can only report "no baseline", which says nothing
 * about whether this commit made anything slower.
 */
export async function baseRef(): Promise<string> {
  return (await harnessRef(MAIN_REFS)) ?? 'HEAD~1';
}

if (import.meta.main) {
  const branch = (process.env.GITHUB_REF_NAME ?? '').trim() || (await currentBranch());
  const plan = await planFor(branch);
  console.log(`gate=${gateWanted(branch, plan)}`);
  console.log(`base=${await baseRef()}`);
  console.log(`phase=${phaseOf(branch) ?? 1}`);
}

async function currentBranch(): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO });
  return stdout.trim();
}
