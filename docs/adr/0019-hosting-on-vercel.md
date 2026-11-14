# 0019. Hosting on Vercel

Status: Accepted, 2026-11-13. Revised the same day after the first deploy failed: the project builds from `apps/web`.

## Context

Apace needs a public URL now, before Phase 1 is finished, so people can open it.

Until Phase 3 there's no server. The app is a static build, and each person's workspace lives in their browser. Hosting it means serving files over HTTPS, which OPFS and the store worker need anyway. The host must:

- build from this monorepo with the toolchain pinned everywhere else: pnpm 11.4.0 and Node 24;
- answer every app route with the app, since routes exist only in the browser;
- never send Cross-Origin-Opener-Policy or Cross-Origin-Embedder-Policy headers, which would break embeds, cross-origin images and sign-in popups (ADR 0002);
- serve the SQLite wasm as `application/wasm`;
- publish `main` on its own, with no manual deploy step.

### What the first deploy showed

The first version kept `vercel.json` at the repo root and left the project's Root Directory there too, with `outputDirectory: apps/web/dist` and Node 24 named in the root `package.json`. That deploy of `main` failed in two ways:

- **It failed with `No Output Directory named "dist" found after the Build completed`.** The install and build had both run.
- **It built on Node 26.13.1,** with pnpm warning that `engines` wanted 24.x.

Vercel's builder for static sites is open source (`@vercel/static-build`), and its code explains both:

- **The error.** It resolves the output directory against the directory of its entry `package.json`, and its error names only the last part of that path.
  - The message has two wordings, and this deploy got the one used when no `vercel.json` with a `buildCommand` sits in the builder's own directory. The repo root had one, so the builder was running in `apps/web`.
  - From there, `apps/web/dist` resolves to `apps/web/apps/web/dist`, which doesn't exist.
- **Node 26.** The builder takes the Node version from the nearest `package.json` at or above that directory. That was `apps/web/package.json`, which had no `engines`, so the project default of 26 applied.

Vercel's docs describe a monorepo app the same way: each project's Root Directory is the app's own directory, and its `vercel.json` sits there.

## Decision

- **Vercel's static hosting, publishing `main`.** Vercel builds every push to `main` and publishes it as production. Other branches get preview deployments.
- **The project's Root Directory is `apps/web`.** It's a dashboard setting, the only one the build needs, since `vercel.json` can't set it.
  - Vercel's option to include files outside the Root Directory in the build stays on, its default. The install needs the workspace root, its lockfile and the other packages.
- **`apps/web/vercel.json` carries the build and the routing.** It's the only `vercel.json` in the repo, and every path in it is relative to `apps/web`.
  - `framework: "vite"`, the preset Vercel detects there anyway.
  - `installCommand`: `npx --yes pnpm@11.4.0 install --frozen-lockfile`.
    - Run in `apps/web`, pnpm finds the workspace root and installs the whole workspace from its lockfile.
    - Vercel picks pnpm 9 or 10 for a lockfile of version 9.0, and honours the `packageManager` field only through an experimental Corepack setting made in the dashboard. Running the pinned pnpm through npx uses 11.4.0 without any setting.
  - `buildCommand`: `npx --yes pnpm@11.4.0 run build`, which runs the app's own `vite build`.
  - `outputDirectory`: `dist`, which is where Vite writes.
- **Node 24.**
  - `apps/web/package.json` names `24.x` in `engines`, because it's the nearest `package.json` to the Root Directory. That's where Vercel reads the version from, and it overrides the dashboard's Node.js Version setting.
  - The root `package.json` and `.node-version` name 24 too, for local work.
  - `pnpm-workspace.yaml` sets `engineStrict: true`, so an install on any other Node fails instead of warning. If Vercel ever builds on another version, the deploy stops before anything ships.
- **Routing.**
  - Files come first: Vercel checks the build output before applying any rewrite.
  - Any other path outside `/assets/` is rewritten to `/index.html`, so every app route opens the app.
  - Paths under `/assets/` aren't rewritten. A missing hashed file is then a 404, not an HTML page the browser would try to run as a script.
- **Headers.**
  - Hashed assets are cached for a year as immutable.
  - Everything else keeps Vercel's default, `public, max-age=0, must-revalidate`, so a new deploy shows on the next load.
  - There's no COOP or COEP header, and Vercel adds neither by default.
- **Serving locally the way Vercel serves.**
  - `bench/serve.ts` serves the builds for the end-to-end tests and the bench. It reads `apps/web/vercel.json` and applies its rules as Vercel does: files first, then the first matching rewrite, then every matching header rule.
  - It refuses any `vercel.json` setting it doesn't implement, such as redirects, clean URLs, conditional rules, or rewrites with parameters or external destinations. So a change there fails locally instead of quietly behaving differently from the deployed site.

## What we gave up

- **A dashboard setting.** The Root Directory lives only in Vercel's project settings. The repo can check its own config against `apps/web`, but not that the setting says so.
- **A strict Node everywhere.** `engineStrict` applies to every install, so local machines and CI must run Node 24 too, as `.node-version` already asks.
- **A vendor's format.** `vercel.json` is Vercel's own. Moving to another host means rewriting it, and the local server's reading of it.
- **An emulation, not Vercel itself.**
  - The local server implements only the part of Vercel's routing that `vercel.json` uses, and it matches paths with the standard `URLPattern` rather than Vercel's own matcher. The two agree on these patterns, but the tests can't prove they agree on others.
  - The hosting tests read the repo the way Vercel's builder does, from its source code, which can change.
- **A download per build.** npx fetches pnpm on every build instead of using the copy in Vercel's image. That adds a few seconds and makes the build depend on the npm registry.
- **Public previews.** Vercel may put preview deployments behind its login. Only the production domain is sure to be public.
- **No server.** Phase 3's sync service holds WebSocket connections, which static hosting doesn't serve. That service will need a host of its own, chosen then.

## How it's verified

- **`bench/hosting.test.ts`** reads the repo from the Root Directory, the way Vercel's builder does:
  - The one `vercel.json` sits in `apps/web`.
  - Its output directory, resolved from there, is the directory Vite's resolved config writes to.
  - The nearest `package.json` at or above `apps/web` names Node 24.x, and so do the root `package.json` and `.node-version`.
  - Installs refuse other Node versions.
  - The commands run the pnpm that `package.json` pins, from a frozen lockfile.
  - It sets no COOP or COEP header.
  - Run against the first deploy's configuration, the test fails on both problems. The output directory resolves to `apps/web/apps/web/dist`, and no Node version is found from `apps/web`.
- **`bench/serve.test.ts`, with `vercel.json`'s rules:**
  - The shell at `/` comes with Vercel's default cache policy and no cross-origin isolation headers.
  - Every app route gets the shell, including ones with a dot or a trailing slash.
  - Hashed assets are cached as immutable, and a missing asset is a 404.
  - Paths that escape the root, and settings the server doesn't implement, are refused.
- **End to end,** against the production build served with those rules:
  - The store opens at a deep route with no console errors.
  - A missing asset is a 404, and the wasm is served as `application/wasm`.
  - No response asks for cross-origin isolation.
- **A clean build,** repeated for this revision:
  - A copy of the repo held only the files git would publish.
  - `vercel.json`'s own install and build commands ran in its `apps/web`, as Vercel runs them with that Root Directory. They used pnpm 11.4.0 on Node 24.13.0.
  - The output landed in the configured output directory, matched the usual build byte for byte, and all 13 end-to-end tests passed against it.
