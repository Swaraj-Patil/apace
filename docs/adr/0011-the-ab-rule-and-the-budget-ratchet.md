# 0011. The A/B rule and the budget ratchet

Status: Accepted, 2026-11-13

## Context

Budgets catch a change that breaks the promise outright. They don't catch the slow slide: twenty steps that each cost five milliseconds, all of them inside budget, which together double the time a page takes to open. By the end of a phase the app is twice as slow and no run ever failed.

The other direction is worse. When a metric does fail, the cheapest way to get green is to move the budget, take fewer samples, drop more warm-up or run the machine faster. Each is a one-line change, and each quietly ends the promise.

So two rules: one that compares a branch with its base, and one that stops the budgets from loosening.

## Decision

### The A/B rule

`pnpm bench:ab` measures this branch against a base, on this machine, in one sitting.

- **The base is built in a git worktree** and served on its own port. Each build keeps its own OPFS data, because the ports differ and OPFS is per origin, so neither has to be reseeded between runs.
- **The runs are interleaved**, three of each, so a machine that gets slower partway through slows both sides.
- **Medians are compared**, run against run, not sample against sample.
- **A metric is worse when both of these hold:**
  - it is more than 10% worse than the base, and
  - it is worse by more than the base's own runs vary, largest minus smallest.
- A metric the base never measured is **new**. A metric the branch no longer measures has **no baseline**. If the base has no harness at all, the comparison says so and compares nothing.
- `--base <ref>` picks another base. Each step compares its uncommitted work with the last commit; CI compares with the previous commit until main has the harness, and with main afterwards.

One test alone isn't enough. Ten percent of a 10 ms metric is a millisecond, which any laptop produces by itself; the spread rule keeps that quiet. And a base that happens to be steady shouldn't make every change a regression; the percentage rule keeps that quiet. Both together mean a failure is a real change, big enough to matter and bigger than the noise.

### The budget ratchet

A test in `pnpm test` compares `bench/budgets.json` with the base's copy and fails if the branch loosened anything:

- a budget rose, including through a longer refresh period;
- a budget started passing at its limit rather than below it;
- a metric disappeared;
- a sample count dropped;
- a warm-up count grew;
- a metric moved to a later phase;
- a metric stopped counting the wait for the next refresh;
- a scrolled view is scrolled for less time;
- the CI CPU throttle went down.

The throttle may go up, which makes the stand-in machine slower and the budgets harder. It may never go down.

Every budget in the brief lives in that file from the start, Phase 2's included, so adding a budget is never part of the change that has to meet it.

### The gate

`pnpm gate` runs check, test, e2e, bench and bench:ab, then fails unless every metric of this phase or an earlier one was measured and inside its budget. The phase comes from the `phase-N` branch name.

Missing counts as failing. A budget that nothing measures is the easiest way to pass a budget, so the gate treats an unmeasured metric exactly like an exceeded one, and names it.

## What we gave up

- **Slow A/B runs.** Installing and building the base, then six measured runs, takes minutes.
- **A noisy machine can still pass a real regression.** A base whose runs vary by 20% forgives a 15% change. The budgets remain the backstop.
- **Three runs is a small sample of runs.** The spread of three medians is a rough estimate of the noise, and a rough estimate is what the rule needs.
- **The ratchet only sees one file.** A change that makes a metric easier some other way — measuring a cheaper page, dropping a scroll target — isn't caught by it. The scenarios are reviewed like any other code.
- **A ratchet that holds mistakes too.** A budget set carelessly tight can only be loosened by a deliberate decision, with this ADR updated. That's the point, but it is a cost.
- **Comparing medians hides the tail.** A change that only hurts the worst 1% of samples moves the p95 but may not move the median of p95s enough to fail.

## How it's verified

- **The rule, in `bench/compare.test.ts`:**
  - Worked examples: a steady branch is the same, a faster one is better, 20% worse on a base that varies more is forgiven, 20% worse on a steady base fails, 5% worse never fails.
  - fast-check properties over random runs: a branch is worse exactly when both tests say so; a branch matching its base is never worse; a faster branch is never worse; making a branch slower never improves its verdict (500 runs each); and widening the base's spread past the change, keeping its median, always forgives it.
  - New metrics and missing baselines are reported, not compared.
- **The ratchet, in `bench/ratchet.test.ts`:** each way of loosening is checked against a crafted budgets file, and each stricter change passes. The repository's own file is compared against every committed copy of itself, so the ratchet guards the real budgets from the next commit onwards.
- **The budgets file** is checked for sense, and for holding every budget the brief promises, for this phase and the next.
