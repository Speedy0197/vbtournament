# Petrus Volleyball Turnier

Fixed six- or seven-team volleyball tournament app, deployed on Cloudflare Workers and D1 with a Pages gateway for the custom domain.

Live scores: https://volleyball.florian-zug.de/ · Admin: https://volleyball.florian-zug.de/admin · QR code: https://volleyball.florian-zug.de/qr

Read [HANDOFF.md](HANDOFF.md) for the current rules, architecture, referee assignments, score corrections, release state and MacBook setup. [DEPLOYMENT.md](DEPLOYMENT.md) contains detailed deployment notes. Earlier design documents are historical; the handoff describes the final tournament configuration.

## Start locally on macOS

Use Node 22 or 24 LTS. Install dependencies on the Mac rather than copying Windows node_modules.

```sh
git clone https://github.com/Speedy0197/vbtournament.git
cd vbtournament
npm ci
ADMIN_PIN=local-preview BASE_URL=http://localhost:3000 PORT=3000 npm start
```

Open http://localhost:3000/admin and use the example local-only password local-preview. Configure the six or seven teams in local setup. The local database is separate from production; cloning does not copy live teams, logos or results.

## Verify

```sh
npm test
npm run test:cloudflare
```

The suites cover local SQLite, the compiled Cloudflare Worker/D1 and the custom-domain gateway, including adaptive timing, partial-set saves, score corrections, standings and tab synchronization. Integration tests use isolated emulator storage. Five-minute breaks and adaptive league timing are preserved; see HANDOFF.md for behavior and deployment details.

Score entry keeps all set rows and the Save result button. Save after one completed set and leave later sets blank; reopen the same match to continue. Enter the points actually played, including 15–12 and 29–27. Incomplete matches stay in progress and do not advance the bracket. The Scores page shows each team once with W/D/L. Another tab in the same browser and origin updates immediately after a successful save; other devices check for changes every five seconds while visible.

Admin’s **Swap upcoming matches** control exchanges two league games, two semifinals or two placement games. Both must be unstarted with no saved scores. Court, order, timetable and referee duties update together; swaps that double-book players or conflict with a started referee duty are refused. Completed results are preserved. Apply migration `0007_match_order.sql` to D1 before deploying this feature; SQLite upgrades automatically. See HANDOFF.md for current release status.

## Deploy an update

Authenticate with the Cloudflare account that owns the existing resources, then deploy from the project root:

```sh
npx wrangler login
npx wrangler d1 migrations apply petrus-volleyball --remote
npm run deploy:cloudflare
npm run deploy:domain
```

The Pages deployment is required for CSS/client.js or gateway changes. Both deployments use the same existing Worker, D1 database and production ADMIN_PIN secret. Routine deployment does not require resetting data, creating resources or changing the admin password. The canonical public and QR URL is https://volleyball.florian-zug.de.
