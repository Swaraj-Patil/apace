# 0010. Benchmark method

Status: Accepted, 2026-11-13

## Context

Apace's promise is a set of numbers: a page opens in under 100 ms, a keystroke paints in under 16 ms, cold start is under 1.5 s. A promise like that is only worth as much as the way it's measured. If the measurement is loose, generous or easy to game, the numbers mean nothing and the budgets stop being a constraint.

So the method has to decide, before any of it is built, where each span starts and stops, which statistic counts, how many samples it takes, and what the browser is doing while it's measured.

## Decision

### The app measures itself

The probes live in `apps/web/src/perf/` and run in every build, production included. The bench build adds hooks that read the samples back, but never the measuring. So the code that is measured is the code that ships.

A probe writes a sample with the moment the span opened, the moment the painting frame ended, and how much of that span was idle. What counts as the sample is the budget's business, not the probe's.

### Where a frame ends

A `requestAnimationFrame` callback runs just before the browser renders. A MessageChannel message posted from inside that callback runs in the next task, after the frame is painted. The timestamp taken there is the end of the painted frame.

If the change the probe is waiting for isn't in the DOM yet, it follows the span to the frame that has it. Each probe carries its own `settled` test.

### Work against idle

From the moment a span opens until its frame is painted, the probe keeps a chain of MessageChannel messages going. Each hop is a task, so anything else with work to do — React, a timer, the Yjs binding, the browser's own rendering — runs between two hops and shows up as a gap. Gaps of 1 ms or less are the chain running on its own: that is idle time. Everything else is work.

Measured on an Apple M4, a key handler asked to busy-wait 4, 10 or 20 ms reads back as 5.0, 10.7 and 20.6 ms: the work it did, plus the frame's own cost of about 0.6 to 1.0 ms. Ten milliseconds of work queued in a timer or a message task before the frame reads the same as ten milliseconds spent in the handler.

A hop costs well under a tenth of a millisecond, so the 1 ms threshold is generous. On a machine slow enough for a hop to exceed it, that gap counts as work, which overstates a sample rather than hiding it.

### Which spans count the idle wait

- **Keystroke latency excludes it.** The budget is 16 ms, one frame, and the wait for the next refresh is the display's, not the app's. Excluding it is what makes the budget about the app.
- **Everything else includes it.** Page open, quick search and cold start are measured from the triggering event to the end of the painted frame, with every part of the wait in them, because that is what the person waiting goes through.

This matters more than it looks. A click whose paint is held back by 30 ms of work reads 30 ms of work, but its whole span measures around 40 ms on a 60 Hz display: the work, then the wait for the next refresh. Both numbers are in the sample, and `bench/budgets.json` names which one each budget uses through `excludeIdle`.

### Statistics

- **Percentiles are nearest-rank.** Every number reported is a sample that was really measured, never an interpolation between two.
- A metric names its statistic; every budget in Phase 1 uses p95.
- **Warm-up samples are taken, dropped, and counted in the report.**
- **A sample that never arrives fails the run.** Samples are never dropped to make a run finish.

A nearest-rank p95 has a property worth stating plainly: with one frame in twenty over budget, the p95 sits just below the slow ones and the metric passes. Anything worse than one in twenty is caught. That is what a p95 budget means, and it's the statistic the brief asks for.

It has a second property, at the other end. A metric of ten samples has no ninety-fifth percentile to find, so its p95 is its slowest sample. `cold-start` is measured over ten reloads, as the brief asks, so the number it reports is the slowest of the ten and carries that sample's whole variance. Measured on an Apple M4, ten reloads of the same build give a median of 42 to 46 ms and a slowest reload of 45 to 81 ms. The spread is the store opening: a reload has to take back the OPFS handles the previous page let go of.

Two consequences. A/B comparisons of `cold-start` move by twenty per cent between runs of identical code, which is why the A/B rule forgives a change smaller than the base's own spread (ADR 0011). And the budget it is judged against, 1,500 ms, has room for that: the slowest reload measured is a twentieth of it.

### Scrolling

`Input.synthesizeScrollGesture` drives each declared view. The gaps between painted frames are snapped to whole refresh periods: a frame that arrives on time is one period, one that misses a refresh is two. Every frame counts as at least one period, so a browser drawing faster than the display can't make a run look better than it is. The worst view's p95 is the metric.

### Cold start

From navigation start to the painted frame where the shell is interactive. "Interactive" is a list of parts, each of which reports when it's ready, and the span ends at the first frame painted after the last of them does. Today that list is the store accepting writes and the shell being painted. The sidebar, the command bar and the restored 3,000-block page join it as those steps land, so the measurement gets stricter over the phase rather than staying still.

Ten reloads are measured after one that isn't.

### The browser

- Chromium through the Playwright library, in headless mode, channel `chromium`.
- A persistent profile in `bench/.profile/<port>`, so the seeded workspace stays in OPFS between runs and a run that changes nothing starts from the same bytes as the last one.
- The viewport is 1536 × 864 at a device scale factor of 1.25.
- The CPU throttle comes from `budgets.json` through CDP's `Emulation.setCPUThrottlingRate`.
- `--trace` writes a Chrome trace to `bench/traces/`.

### Seeding

The workspace is seeded through the store worker, never through the UI. The seed and the generator version are written next to the profile, and a run seeds again only when one of them changes. `bench/results/<sha>.json` records which run seeded.

### Features

Every metric names a feature. The app declares the features it has in `apps/web/src/features.ts`, and the runner measures a metric only when its feature is declared and a scenario exists to measure it. Anything else of this phase or earlier is reported as not measured, with the reason.

A budget that nothing measures is not a budget that passes: the gate (ADR 0011) fails on it.

## What we gave up

- **Timer resolution.** Without cross-origin isolation, which ADR 0002 refuses, `performance.now()` is coarse. That's immaterial against a 16 ms budget and the 0.1 ms steps seen in practice.
- **The chain costs something.** Keeping MessageChannel hops going is itself work, perhaps a tenth of a millisecond per frame. It inflates what it measures slightly, and never flatters it.
- **Headless isn't a display.** Frames are produced by a scheduler rather than a monitor. Scroll numbers are about the main thread, not about what a screen would show.
- **One machine, one browser.** The budgets are checked on Chromium. Other engines, and other refresh rates, aren't measured.
- **A p95 lets one frame in twenty through.** See above; it's the agreed statistic, and the A/B rule catches the drift a p95 would hide.
- **The probes can only see the main thread.** Compositor work, raster and GPU time are outside them.

## How it's verified

The probes are calibrated against synthetic work with known costs, on a bench-only page (`apps/web/probe.html`) that uses the same probes as the app. In `apps/web/e2e/probe.spec.ts`:

- A key handler that busy-waits 4, 10 or 20 ms reads back as that work plus a frame cost of no more than 2 ms, and the reading grows by exactly the work added, within 1 ms.
- Ten milliseconds of work queued in a `setTimeout` or a MessageChannel task before the frame reads the same as ten milliseconds spent in the handler, within 1 ms. It isn't hidden as idle.
- A click whose paint is held back by 30 ms reads 30 ms of work within 2 ms, and its whole span is at least that and less than one refresh period more.
- A 50 ms stall every 20 frames shows up: each stall costs one frame, the snapped intervals show three refresh periods or more, and the count matches the stalls the page performed. The same stall every 10 frames reaches the p95, which is where a nearest-rank p95 starts to catch it.

The arithmetic has unit tests of its own in `bench/stats.test.ts`: percentiles return real samples and cover at least the share they name (fast-check, 300 runs each), snapping never counts a frame as less than one period, and the worked examples are read off by hand.

`bench/budgets.json` is checked for sense on every run: positive limits, samples and throttle, a known statistic, and a feature for every metric.

Measured on an Apple M4 with the throttle at 1×, `cold-start` reads a p50 of 42 to 46 ms and a p95 — the slowest of its ten reloads — of 45 to 81 ms, against its 1,500 ms budget, with the shell as it stands today.
