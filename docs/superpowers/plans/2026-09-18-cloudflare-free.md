# Cloudflare Free Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task in the isolated worktree.

**Goal:** Host the tournament on free Workers/D1 with match-result refreshes.

**Architecture:** A shared Express application accepts asynchronous database and icon storage adapters. Node uses the existing SQLite database and files; Workers use D1 and precompiled EJS views.

**Tech Stack:** Node, Express, EJS, Wrangler, Miniflare, D1, node:test.

**Spec:** docs/superpowers/specs/2026-09-18-cloudflare-free-design.md

## Global constraints

- Workers Free and D1 Free only; no paid plan, domain, R2, or Railway changes.
- Public refresh is 120 seconds with a manual refresh link; admin forms never auto-refresh.
- Preserve existing tournament features and current working changes.
- Preserve the 5 MiB icon upload limit; keep secrets and databases out of assets.

## Task 1: Shared routes and persistent D1 storage

- [x] Add a Miniflare integration test that sends real HTTP requests through the Worker. Assert unauthorized changes redirect, six teams create 15 matches, completed scores survive a runtime restart, failed schedule replacement rolls back, icons survive restart, and a missing ADMIN_PIN disables admin access.
- [x] Run the new test and verify it fails because no Worker build exists.
- [x] Extract app.js from server.js, retaining route behavior while awaiting database methods. Keep server.js as the local entrypoint. Add D1 database and icon adapters and schema migrations in cloudflare/ and migrations/.
- [x] Precompile EJS with ejs.compile(source, {client:true, filename}), then export a renderer with relative include resolution. Bundle the Worker with esbuild and serve only copied public CSS/JS assets.
- [x] Configure Wrangler with DB, workers.dev, node compatibility, and local migrations. Use Miniflare to run the real bundle and schema. Run the integration test until the migration scenarios pass.

## Task 2: Match-result refresh and compatibility

- [x] Verify public rendering and hidden-tab refresh behavior using a DOM timer harness; verify no automatic refresh is attached to admin pages.
- [x] Replace the ten-second meta refresh with a 120-second visible-tab timer, a Refresh scores link, and match-result wording. Keep existing page layout.
- [x] Run local route tests, tournament tests, and Worker tests; compare with captured baseline failures so unrelated unfinished changes are not overwritten.

## Task 3: Deployment preparation and verification

- [x] Add a deployment guide with local test, D1 creation/migration, secret entry, deployment, backup, and quota checks. Require account authentication through Wrangler instead of asking for pasted credentials.
- [x] Inspect the final bundle and static assets for excluded files. Deployment dry run passed. HTTP rendering and DOM timer checks passed; interactive browser checks were unavailable because the computer-use runtime could not initialize.
- [x] User confirmed Workers Free; production Worker and D1 created and deployed. Full six-team live rehearsal and browser checks passed on a separate temporary instance. CPU checks led to resizing photos in the browser before upload.
- [x] Review the migration diff, commit only migration work separately from its baseline snapshot, and make the result available without overwriting concurrent work in the original checkout.

## Verification recorded 2026-09-18

70 local/unit tests and 12 Cloudflare integration tests passed. The Worker dry run contains two allowlisted static files and a 319.55 KiB gzip bundle. Dependency audit reports zero known vulnerabilities. Review fixes include atomic bracket creation with injected-failure/retry coverage, hosted password length enforcement, and immutable edge caching for icons. Latest existing scoring-rule and pause controls were captured in baseline commit 7483cf0 before the migration commit.

Deployment on 18 September 2026: https://petrus-volleyball.post8070.workers.dev. Admin secret configured; private password file remains ignored. Real production team data was not seeded or reset. Browser verification now passes through isolated headless Edge, including an ImageBitmap-disabled fallback.
