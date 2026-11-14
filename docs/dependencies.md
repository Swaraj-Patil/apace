# Dependencies

Every dependency is pinned to an exact version, and pnpm refuses any release less than a day old. Each entry says why the package is here. The GitHub Actions that CI runs are pinned the same way, and listed at the end.

## App

- `react` 19.3.1: the UI library.
- `react-dom` 19.3.1: renders React components into the browser DOM.
- `@sqlite.org/sqlite-wasm` 3.54.1-build1: SQLite compiled to WebAssembly, with the opfs-sahpool file system that keeps the workspace in OPFS without cross-origin isolation.
- `yjs` 13.6.33: the CRDT whose updates are the workspace's source of truth; the model builds the page tree on it, the seed generator writes the seeded workspace as its updates, and the store merges them when it loads and compacts docs and projects them into its tables.
- `@tiptap/pm` 3.33.1: ProseMirror's packages as TipTap ships them; the model builds the page schema with its `model` package.
- `@tiptap/y-tiptap` 3.3.0: the ProseMirror–Yjs binding TipTap's Collaboration extension uses; the model converts pages through it, so every writer encodes them the same way.
- `y-protocols` 1.0.7: Yjs's sync and awareness protocols, which y-tiptap needs as a peer; it's pinned here rather than left to pnpm's automatic peer install, so its version can't drift.

## Build

- `vite` 8.3.8: the dev server and production bundler for the web app; the bench's hosting tests also read the web app's resolved build settings through it.
- `@vitejs/plugin-react` 6.3.0: React's JSX transform and fast refresh inside Vite.
- `typescript` 6.0.3: type checking only, since Vite and Node strip types themselves.
- `@types/react` 19.3.0: type definitions for React.
- `@types/react-dom` 19.3.0: type definitions for React DOM.
- `@types/node` 24.19.2: type definitions for the Node 24 APIs that configs, bench scripts and end-to-end tests use.

## Quality

- `@biomejs/biome` 2.6.6: linting and formatting in one tool.
- `vitest` 4.1.12: unit and property tests, reusing Vite's transform pipeline.
- `fast-check` 4.10.2: property-based tests that generate random edit histories and check what must hold for all of them.
- `@playwright/test` 1.65.0: end-to-end tests that drive Chromium.
- `playwright` 1.65.0: the same browser automation as a library rather than a test runner, which the bench harness uses to drive Chromium with a persistent profile, a CPU throttle and Chrome traces.

## Continuous integration

These aren't packages: they're the actions `.github/workflows/ci.yml` uses, pinned to exact releases rather than to a moving major tag, so a run of CI is as repeatable as a run of the bench.

- `actions/checkout` 7.0.1: checks the repository out with its whole history, which the A/B run needs to build the base in a worktree.
- `pnpm/setup` 3.2.0: installs pnpm from the `packageManager` field and Node from `.node-version`, caches the pnpm store and runs a frozen install, so CI uses the versions this repository pins.
- `actions/cache` 6.1.0: keeps the downloaded Chromium between runs, which is most of the time a cold run spends.
- `actions/upload-artifact` 7.0.2: keeps the bench reports and the traces of any failure.
