// `pnpm gate`. Runs everything, then decides whether this phase can merge.
//
// The gate is the only place that says a phase is finished, so it fails when a metric of this
// phase or an earlier one is missing, not only when one is over budget. A metric nobody
// measures is not a metric that passes.
//
// Run with: node bench/gate.ts [--phase 1] [--base main]
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { metricsForPhase, readBudgets } from './budgets.ts';
import type { RunResult } from './report.ts';
import { RESULTS_DIR } from './run.ts';

const REPO = fileURLToPath(new URL('../', import.meta.url));

export interface StepResult {
  readonly step: string;
  readonly ok: boolean;
  readonly code: number | null;
}

function run(command: string, args: readonly string[]): Promise<number | null> {
  return new Promise((done) => {
    const child = spawn(command, [...args], { cwd: REPO, stdio: 'inherit' });
    child.on('close', (code) => done(code));
  });
}

/** The metrics this phase owes that the run didn't measure. */
export function metricsOwed(run: RunResult, owed: readonly string[]): string[] {
  const measured = new Set(run.metrics.map((metric) => metric.metric));
  return owed.filter((metric) => !measured.has(metric));
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { phase: { type: 'string' }, base: { type: 'string', default: 'main' } },
  });
  const budgets = await readBudgets();
  const branch = (process.env.GATE_BRANCH ?? '').trim() || (await branchName());
  const phase = Number(values.phase ?? /^phase-(\d+)$/.exec(branch)?.[1] ?? 1);

  const steps: StepResult[] = [];
  for (const [step, command, args] of [
    ['check', 'pnpm', ['run', 'check']],
    ['test', 'pnpm', ['run', 'test']],
    ['e2e', 'pnpm', ['run', 'e2e']],
    ['bench', 'node', ['bench/run.ts', '--phase', String(phase)]],
    [
      'bench:ab',
      'node',
      ['bench/ab.ts', '--base', values.base ?? 'main', '--phase', String(phase)],
    ],
  ] as const) {
    console.log(`\n──────── ${step} ────────`);
    const code = await run(command, args);
    steps.push({ step, ok: code === 0, code });
  }

  const owed = metricsForPhase(budgets, phase);
  const latest = await latestRun();
  const missing = latest === null ? owed : metricsOwed(latest, owed);
  const over = (latest?.metrics ?? []).filter((metric) => !metric.withinBudget);

  console.log(`\n──────── gate for phase ${phase} ────────`);
  for (const step of steps) console.log(`${step.ok ? 'passed' : 'FAILED'}  ${step.step}`);
  if (missing.length > 0) console.log(`\nNot measured yet: ${missing.join(', ')}`);
  if (over.length > 0) {
    console.log(`Over budget: ${over.map((metric) => metric.metric).join(', ')}`);
  }

  const passed = steps.every((step) => step.ok) && missing.length === 0 && over.length === 0;
  await mkdir(RESULTS_DIR, { recursive: true });
  const report = {
    phase,
    branch,
    passed,
    steps,
    missing,
    over: over.map((metric) => metric.metric),
    run: latest,
  };
  // A report from a dirty tree says so in its name, so it can't be mistaken for a clean one.
  const path = join(
    RESULTS_DIR,
    `gate-${latest?.sha ?? 'unknown'}${latest?.dirty === true ? '-dirty' : ''}.json`,
  );
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${passed ? 'Gate passed' : 'Gate failed'}. Saved to ${path}`);
  process.exitCode = passed ? 0 : 1;
}

async function branchName(): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: REPO,
  });
  return stdout.trim();
}

/** The most recent run `pnpm bench` wrote. */
async function latestRun(): Promise<RunResult | null> {
  const { readdir, readFile, stat } = await import('node:fs/promises');
  try {
    const files = (await readdir(RESULTS_DIR)).filter(
      (name) => name.endsWith('.json') && !name.startsWith('gate-'),
    );
    const times = await Promise.all(
      files.map(async (name) => ({
        name,
        at: (await stat(join(RESULTS_DIR, name))).mtimeMs,
      })),
    );
    const newest = times.sort((a, b) => b.at - a.at)[0];
    if (newest === undefined) return null;
    return JSON.parse(await readFile(join(RESULTS_DIR, newest.name), 'utf8')) as RunResult;
  } catch {
    return null;
  }
}
