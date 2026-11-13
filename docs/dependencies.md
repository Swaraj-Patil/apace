# Dependencies

Every dependency is pinned to an exact version, and pnpm refuses any release less than a day old. Each entry says why the package is here.

## App

- `react` 19.3.1: the UI library.
- `react-dom` 19.3.1: renders React components into the browser DOM.
- `@sqlite.org/sqlite-wasm` 3.54.1-build1: SQLite compiled to WebAssembly, with the opfs-sahpool file system that keeps the workspace in OPFS without cross-origin isolation.
- `yjs` 13.6.33: the CRDT whose updates are the workspace's source of truth; the model builds the page tree on it, and the store merges its updates when it loads and compacts docs.

## Build

- `vite` 8.3.8: the dev server and production bundler for the web app.
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
