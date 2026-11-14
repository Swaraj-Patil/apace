# 0012. The CI runner stands in for a mid-range laptop, and the throttle only goes up

Status: Accepted, 2026-11-14

## Context

Apace's budgets are promises about a machine: a page opens in under 100 ms, a keystroke paints in under 16 ms, cold start is under 1.5 s, "on a mid-range laptop in Chrome". Every push has to be measured against something, and that something has to be the same machine every time or the numbers mean nothing.

No laptop can do that job. It's one person's, it's busy with other work, and nobody else can reproduce what it says. So CI measures, and the question becomes which machine CI uses and how to notice when it changes.

A hosted runner is a shared virtual machine. It is slower than a laptop, its speed varies between runs, and its hardware is replaced over the years without telling anyone. Each of those can move a measurement without a line of the app changing.

## Decision

### The machine

- **GitHub's standard Linux runner**, which is free for this public repository: 4 vCPUs, 16 GB.
- **Pinned to `ubuntu-24.04`, never `ubuntu-latest`.** A label that moves would swap the machine under the budgets on GitHub's schedule rather than on ours. `bench/budgets.json` names the same runner, and a test fails if the two disagree.
- **Node from `.node-version` and pnpm from `packageManager`**, with a frozen install. `engineStrict` turns a wrong Node version into a failed install rather than a warning, so CI can't quietly measure a different runtime from the one this repository pins.

### The throttle

The CPU throttle lives in `bench/budgets.json` and starts at **1×**: the runner is already slower than a developer's laptop, so nothing needs to be added to make it a fair stand-in. It may be raised, which makes the stand-in slower and every budget harder. It may never be lowered — the ratchet (ADR 0011) fails a run that tries.

Local runs are reported and never gate. A laptop that is three times faster than the runner will show it in every number, and a developer who wants comparable numbers raises their own throttle to match. The relationship between the two machines is what the calibration below measures.

### Calibration, in every report

Each run records the CPU model, the core count, the throttle, and **the time of a fixed workload** (`bench/calibration.ts`): twenty million rounds of integer arithmetic, timed five times, median reported in milliseconds, before the browser starts.

Every operation in it is exact in any JavaScript engine, so the workload returns the same checksum on every machine and only the time differs. A test pins that checksum: changing the arithmetic is then a deliberate act, because runs of two different workloads can't be read against each other.

That number does two jobs. It says what a laptop's numbers are worth next to the runner's, and it turns "the runner got faster" into something visible in the report rather than a mystery in the metrics.

### What a run does

- `pnpm check`, `pnpm test`, `pnpm e2e`, `node bench/run.ts`, then `node bench/ab.ts`, each as its own step, so a failure names itself.
- **Once a phase branch has every step of its plan ticked, the run is the gate instead** (ADR 0011), which runs all of the above and then decides whether the phase can merge.
- The A/B run compares against **main once main has the bench harness, and against the commit before this one until then**. A base without the harness can only report "no baseline", which says nothing about whether a commit made anything slower.
- Both decisions are made by `bench/ci.ts`, which is tested, rather than by conditions written in YAML, which aren't.
- The bench table goes into the run's job summary. Reports and the traces of any failure are kept as artifacts for 30 days.
- One run per branch: a newer push replaces a run still going.

## What we gave up

- **A shared runner is noisy.** Its numbers vary more than a quiet laptop's. The A/B rule's spread test absorbs that, and the Phase 1 budgets have room in them.
- **The calibration only measures one core doing arithmetic.** A runner whose disk or memory changed, but whose CPU didn't, wouldn't show up in it.
- **Linux and headless Chromium are not "a mid-range laptop in Chrome".** They're a stand-in that can be held still, which the brief's machine cannot.
- **A pinned image ages.** `ubuntu-24.04` will be retired one day, and moving off it is a deliberate change that will move every number with it.
- **One job, one machine, no matrix.** Other operating systems, browsers and screen refresh rates aren't measured.
- **Cancelling a run that a newer push replaced** means the older commit's numbers are never recorded.
- **A wall-clock cap of 45 minutes.** A run that hangs is killed rather than burning the day. A full run takes about a third of that, so the cap is a backstop and not a target.

## How it's verified

- `bench/workflow.test.ts`: the workflow names the runner the budgets were set for, never a moving label, checks out the history the A/B run needs, pins every action to an exact release, runs each command, and keeps the reports whether the run passed or failed.
- `bench/ci.test.ts`: which branches run the gate, which run the commands, and that the A/B base is main only once main has the harness.
- `bench/calibration.test.ts`: the workload returns its pinned checksum, changes its answer when the amount of work changes, and times itself.
- `bench/ratchet.test.ts`: a run that lowers the CI throttle fails.
- The workflow passing on GitHub, which is the only place it can be run.
