# 0001. Toolchain and workspace layout

Status: Accepted, 2026-11-12

## Context

Apace is a local-first web app whose central promise is speed, and a benchmark suite enforces it. The code has four parts that share types and logic:

- The web app, with its store worker.
- A pure domain model, used by the app, the worker and the benchmarks.
- A deterministic generator that seeds benchmark workspaces.
- The benchmark harness, which runs under Node.

The toolchain has to keep all four in one language with no build step between them. It also has to stop dependency drift from moving benchmark numbers, and stay small enough to understand.

## Decision

- **Workspace.** pnpm workspaces with four packages: `@apace/web` (in `apps/web`), `@apace/model`, `@apace/seed` and `@apace/bench`. pnpm is pinned at 11.4.0 through `packageManager`, so local and CI installs resolve the same way. Node is 24, pinned by `engines` and `.node-version`.
- **TypeScript source, no package builds.** Workspace packages export `src/index.ts`. Vite bundles that source for the browser, and Node 24 runs it directly by stripping types, so the bench scripts run with plain `node`.
- **TypeScript 6 for checking only.** It runs with `noEmit`, `erasableSyntaxOnly` and `verbatimModuleSyntax`. Erasable syntax is what lets Node strip types without a compiler. That rules out enums, namespaces with runtime code, parameter properties and decorators. Relative imports name their `.ts` file, which Node, Vite and TypeScript all resolve.
- **App.** Vite 8 with `@vitejs/plugin-react` 6 and React 19.3. `vite build --mode bench` produces a separate bench build that includes `src/bench/`. In production builds that import sits behind a condition Vite folds to false, so the bench code is never emitted.
- **Tests.** Vitest 4 runs unit and property tests, with one project per package. Playwright 1.65 runs end-to-end tests against production builds. Retries are 0 and `forbidOnly` is set, so a flaky or focused test fails the run instead of passing quietly.
- **Serving builds.** `bench/serve.ts` is a small static server for production and bench builds, used by tests and benchmarks. It controls the things that change measurements:
  - Caching: hashed assets are cached forever and the shell is revalidated.
  - Headers: it sends no COOP or COEP, which the app is built to run without.
- **Lint and format.** Biome 2, one tool in place of ESLint and Prettier.
- **Dependencies.** Exact versions, never ranges, with the lockfile committed. pnpm refuses packages published less than a day ago (`minimumReleaseAge: 1440`). With `minimumReleaseAgeStrict` it fails the install instead of quietly exempting a too-new package. Each dependency gets one sentence in `docs/dependencies.md`.

## What we gave up

- Enums, value namespaces, parameter properties and decorators. String-literal unions and plain objects replace them.
- Publishable packages. Consumers must handle TypeScript source. Vite, Vitest and Node 24 do, which covers everything in this repo.
- Node versions before 24, which can't run the bench scripts.
- ESLint's plugin ecosystem. Biome's built-in rules cover React hooks and accessibility basics, but custom rules would need another tool.
- The newest releases. Exact pins and the one-day release-age floor make every upgrade a deliberate commit. TypeScript 7 and Vitest 5 are reviewed at the end of Phase 1. Biome is on 2.6.6 because 2.6.7 was under a day old when the workspace was set up.

## How it's verified

- `bench/smoke.test.ts` runs `node bench/smoke.ts` in a child process. The script imports `@apace/seed`, which imports `@apace/model`, all as TypeScript source. The test requires an exit code of 0 and empty stderr.
- `bench/serve.test.ts` covers the server's content types, caching, app-route fallback, path containment, allowed methods and the absence of cross-origin isolation headers.
- `apps/web/e2e/shell.spec.ts` loads the production build in Chromium and checks four things:
  - The shell paints with no console errors.
  - No response sends COOP or COEP, and `crossOriginIsolated` is false.
  - The production build contains no bench code.
  - The bench build exposes `window.__bench`.
- `pnpm check` runs Biome and TypeScript across every package.
