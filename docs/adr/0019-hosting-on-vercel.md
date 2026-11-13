# 0019. Hosting on Vercel

Status: Accepted, 2026-11-13

## Context

Apace needs a public URL now, before Phase 1 is finished, so people can open it.

Until Phase 3 there's no server. The app is a static build, and each person's workspace lives in their browser. Hosting it means serving files over HTTPS, which OPFS and the store worker need anyway. The host must:

- build from this monorepo with the toolchain pinned everywhere else: pnpm 11.4.0 and Node 24;
- answer every app route with the app, since routes exist only in the browser;
- never send Cross-Origin-Opener-Policy or Cross-Origin-Embedder-Policy headers, which would break embeds, cross-origin images and sign-in popups (ADR 0002);
- serve the SQLite wasm as `application/wasm`;
- publish `main` on its own, with no manual deploy step.

## Decision

- **Vercel's static hosting, publishing `main`.** Vercel builds every push to `main` and publishes it as production. Other branches get preview deployments.
- **`vercel.json` at the repo root carries the build and the routing,** so the dashboard needs no settings beyond importing the repo.
  - `framework: null`, so no framework preset guesses at the build.
  - `installCommand`: `npx --yes pnpm@11.4.0 install --frozen-lockfile`. Vercel picks pnpm 9 or 10 for a lockfile of version 9.0. It honours the `packageManager` field only through an experimental Corepack setting made in the dashboard. Running the pinned pnpm through npx uses 11.4.0 without any dashboard setting.
  - `buildCommand`: `npx --yes pnpm@11.4.0 --filter @apace/web build`, which builds only the web app.
  - `outputDirectory`: `apps/web/dist`.
  - Node 24 comes from `engines.node` in the root `package.json`, which overrides the dashboard's Node.js version. It's now written `24.x`. That covers the same versions as `>=24 <25`, but it's the form Vercel's docs list.
- **Routing.**
  - Files come first: Vercel checks the build output before applying any rewrite.
  - Any other path outside `/assets/` is rewritten to `/index.html`, so every app route opens the app.
  - Paths under `/assets/` aren't rewritten. A missing hashed file is then a 404, not an HTML page the browser would try to run as a script.
- **Headers.**
  - Hashed assets are cached for a year as immutable.
  - Everything else keeps Vercel's default, `public, max-age=0, must-revalidate`, so a new deploy shows on the next load.
  - There's no COOP or COEP header, and Vercel adds neither by default.
- **Serving locally the way Vercel serves.**
  - `bench/serve.ts` serves the builds for the end-to-end tests and the bench. It now reads `vercel.json` and applies its rules as Vercel does: files first, then the first matching rewrite, then every matching header rule.
  - It refuses any `vercel.json` setting it doesn't implement, such as redirects, clean URLs, conditional rules, or rewrites with parameters or external destinations. So a change there fails locally instead of quietly behaving differently from the deployed site.

## What we gave up

- **A vendor's format.** `vercel.json` is Vercel's own. Moving to another host means rewriting it, and the local server's reading of it.
- **An emulation, not Vercel itself.** The local server implements only the part of Vercel's routing that `vercel.json` uses. It matches paths with the standard `URLPattern`, not Vercel's own matcher. The two agree on these patterns, but the tests can't prove they agree on others.
- **A download per build.** npx fetches pnpm on every build instead of using the copy in Vercel's image. That adds a few seconds and makes the build depend on the npm registry.
- **Public previews.** Vercel may put preview deployments behind its login. Only the production domain is sure to be public.
- **No server.** Phase 3's sync service holds WebSocket connections, which static hosting doesn't serve. That service will need a host of its own, chosen then.

## How it's verified

- **`bench/hosting.test.ts`:**
  - `vercel.json` installs and builds with the pnpm that `package.json` pins, from a frozen lockfile.
  - Node is 24 in `engines` and in `.node-version`.
  - It publishes `apps/web/dist` with no framework preset.
  - It sets no COOP or COEP header.
- **`bench/serve.test.ts`, with `vercel.json`'s rules:**
  - The shell at `/` comes with Vercel's default cache policy and no cross-origin isolation headers.
  - Every app route gets the shell, including ones with a dot or a trailing slash.
  - Hashed assets are cached as immutable, and a missing asset is a 404.
  - Paths that escape the root, and settings the server doesn't implement, are refused.
- **End to end,** against the production build served with those rules:
  - The store opens at a deep route with no console errors.
  - A missing asset is a 404, and the wasm is served as `application/wasm`.
  - No response asks for cross-origin isolation.
- **A clean build,** done once before the first deploy:
  - A copy of the repo held only the files git would publish. It was built with `vercel.json`'s own install and build commands, which ran pnpm 11.4.0 on Node 24.13.0.
  - Its output matched the usual build byte for byte, and all 13 end-to-end tests passed against it.
