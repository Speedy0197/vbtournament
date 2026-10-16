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

The latest deployed update passed 120 tests across local SQLite, the compiled Cloudflare Worker/D1 and the custom-domain gateway. Integration tests use isolated emulator storage. Five-minute breaks and adaptive league timing are live; see HANDOFF.md for behavior and deployment details.

## Deploy an update

Authenticate with the Cloudflare account that owns the existing resources, then deploy from the project root:

```sh
npx wrangler login
npx wrangler d1 migrations apply petrus-volleyball --remote
npm run deploy:cloudflare
npm run deploy:domain
```

The Pages deployment is required for CSS/client.js or gateway changes. Both deployments use the same existing Worker, D1 database and production ADMIN_PIN secret. Routine deployment does not require resetting data, creating resources or changing the admin password. The canonical public and QR URL is https://volleyball.florian-zug.de.
