# Petrus Volleyball code and deployment handoff

Updated 20 October 2026 after the tournament on 17 October, Europe/Berlin. Upcoming-match swapping and the simplified Admin standings are deployed on top of single-set saving, immediate score updates and adaptive league timing. This release is versioned on main.

# Latest release · upcoming-match swapping · 20 October 2026

Admin now offers **Swap upcoming matches** collapsed below **Awaiting results**. Select two league games, two semifinals or two placement games and press **Swap matches**. Both must still be pending with no saved sets. League games can exchange courts and rounds; semifinals and placements exchange their order within the existing phase. A final cannot move ahead of its semifinals. Swapping the same pair again restores their previous slots. Admin also uses one collapsed combined standings table, listing each team once, instead of a separate places 5–7 table plus full league standings. When the tournament is complete, only the final standings summary is shown.

Match IDs, participants, scores and finish timestamps remain attached to their games. Slots exchange their position, court and label. The public screen, score-entry queue, print schedule and adaptive league timing use that order. Successful swaps use the existing immediate-tab notification and score-version polling. Old swap and score forms are rejected after affected schedule changes, and SQLite transactions / guarded D1 batches protect concurrent saves and roll back failed swaps.

League swaps are refused if a team would play on both courts in one round. Referees in affected rounds are reassigned to idle teams where necessary; started/scored games keep their assignments. Manual changes can alter the original equal-duty totals. Semifinal referee duties follow the new order, including the six-team placement referee. Finish an active six-team placement game before swapping its semifinals. Later league-result corrections retain the manually chosen order while reseeding the original qualifying pairings.

Migration **0007_match_order.sql** adds nullable `matches.schedule_order`; existing games fall back to their IDs without any schedule reset. SQLite applies it on startup. Migration 0007 is applied to the existing production D1 database. Worker version `a66ffcc0-2fa6-43b0-b5ec-dcf6b99f1b13` and Pages deployment `61118e5d.petrus-volleyball.pages.dev` are live. Both deployments are required for this release because Admin spacing adds CSS.

Verification: the complete local suite passes 109 tests; the compiled Cloudflare/D1/gateway suite passes 58 tests, including shared swap scenarios for both event sizes, referee conflicts, placement order, semifinal corrections and advancement, stale forms, concurrent-result protection and transaction rollback. An isolated browser preview confirmed that swapping semifinals changes the next Court 1 game and its referee, the swap control follows Awaiting results, and the combined standings list each team once. Live read-only checks on the custom, Worker and Pages hosts confirmed matching deployed assets, seven final-standing rows, working scores/login/QR pages and all logos accessible. All pre-existing API state fields are identical before and after release: seven teams, 27 completed matches and 55 saved sets. Only the new nullable schedule-order field was added; it remains null for all 27 existing games. No production scores or pairings were submitted or changed, and foreign-key checks are clean.

# Earlier release · single-set saving · 20 October 2026

Source commit `e54e622ea48d5ba65774b5d9fb0973d44973a3fc` preserves the original score form and accepts one completed set at a time, including shorter or extended scores such as 15–12 and 29–27. Partial matches remain active and do not record a finish timestamp or advance the bracket. The compact public table retains W/D/L and lists each team once. Same-origin tabs in one browser receive immediate save notifications; other devices check for changed scores every five seconds while visible.

All 141 tests passed (96 local and 45 compiled Cloudflare/D1/gateway), retaining adaptive timing and five-minute breaks from the newer main commits. Worker version `6a7e95de-c785-4709-995e-daeef8f4d0da` and Pages deployment `0bfddab9.petrus-volleyball.pages.dev` are live. No migration, schedule reset or secret change was needed. Read-only HTTPS checks on the custom domain, Workers address and Pages address confirmed matching deployed client/CSS assets, score-version headers, all seven final-standing rows, login and QR pages, and all seven logos. The entire production /api/state response was identical before and after deployment: seven teams, 27 completed matches and 55 saved sets. No sample results were submitted to production.

# Earlier UI cleanup · 16 October 2026

Removed the explanatory timing paragraph and the visible “Auto-refresh · every 2 min” label from public Scores at the user's request. Automatic refresh still runs every 120 seconds while visible, and the manual Refresh scores button remains. All 37 Cloudflare/D1/gateway tests and both client refresh tests passed before deploying Worker version `693b7d22-15bb-4359-b895-4e4443c35ba2`. Live verification confirmed the label is absent, the refresh marker and client script remain, and the entire production state is identical before and after deployment: seven teams, 21 pending matches and no saved scores. The demonstration results and delay remain exclusively in the separate local preview database. No migration or Pages asset deployment was needed.

# Adaptive league timing

The user requested five-minute breaks between league rounds and adaptive times after entering results. Both courts remain synchronized. A round's next start is projected five minutes after the later saved result, rounded up to the next minute and never earlier than the current round's 20-minute playing estimate. All following rounds and the overall finish estimate shift together. A longer break is reflected once the following round's results are saved; the app does not observe actual starts. Save results promptly, since delayed entry also delays the estimates. Corrections retain the original finish timestamp and do not move the timetable.

Existing match IDs, pairings, referees, teams, logos and results are preserved. Timetables are projected on reads; adopting breaks does not require resetting/regenerating the schedule. New schedules also include the breaks. Seven-team league estimates run 10:00–14:30; six teams run 10:00–13:15. The scheduled breaks consume 50/35 minutes of the existing 65-minute allowance, leaving 15/30 minutes for later breaks and delays. The initial overall estimates remain 16:45/15:45.

Migration `0006_adaptive_timing.sql` adds nullable `matches.completed_at`. SQLite applies it automatically on startup. D1 requires applying it before deploying the new Worker. First-time completed scores record the timestamp atomically with the result in both adapters. Existing historical results retain null timestamps and use planning estimates.

Release verification: `npm test` (83 tests) and `npm run test:cloudflare` (37 tests) passed, including shared SQLite/D1 timing cases, compiled templates, legacy schedule adoption without writes, longer breaks, corrections, invalid/stale submissions and overall finish estimates after the final league result. Migration 0006 and Worker version `9dff8e41-5314-4e84-829d-7b1069fea100` were deployed on 16 October. Live HTTPS checks confirmed the five-minute gaps, 14:30 league finish and 16:45 overall planning estimate. All seven teams/logos and all 21 pending matches, pairings, referees and empty scores were preserved. Scores, login and QR routes returned 200. No Pages deployment was needed because public assets and the gateway did not change.

Mac access checked: Node 24.14.0 is available and `npm ci` installed the locked dependencies. The user completed `npx wrangler login`, and `whoami` confirmed access to the configured account. This Mac successfully applied the production migration and deployed the Worker. The adaptive-timing source, migration, regression tests and release notes are versioned together in this repository.

# Start here

- Live scores: https://volleyball.florian-zug.de/
- Admin and score entry: https://volleyball.florian-zug.de/admin
- QR code: https://volleyball.florian-zug.de/qr
- Printable schedule with referee assignments: https://volleyball.florian-zug.de/admin/print
- Original backend address: https://petrus-volleyball.post8070.workers.dev/
- Pages gateway: https://petrus-volleyball.pages.dev/
- Repository: https://github.com/Speedy0197/vbtournament

The released application's source is published on the main branch of https://github.com/Speedy0197/vbtournament, including the adaptive-timing update developed from commit aadd9e116fa2796d6723b92762192138ea763451. The private ChatGPT handoff also retains a source snapshot captured before the GitHub publication. The earlier UI release was developed from commit a0f39c1be4bdb8da6356ba955af78384b22d1d22.

The live read-only release check on 20 October found seven teams, all 27 matches completed and 55 saved sets; the entire production state was preserved during deployment. The earlier 16 October pre-tournament check had 21 pending league matches with no scores. Re-read /api/state before treating either snapshot as current. The demo results described below exist only locally.

# Fixed tournament rules

The seven registered teams are Grüne Gurken, Hochball, Halb Netz Halb Aus, Netzfetzer, Netzflüsterer, Blockwürstchen and Petrus Team 26. Preserve their existing IDs and uploaded logos.

- Two courts, approximately seven hours. The league starts at 10:00; games have two independent 10-minute sets with a five-minute break between rounds. Remaining times adapt after both court results are saved.
- Finish the current rally at the buzzer. Any lead wins a timed set; if tied, one deciding rally settles it. Start the next set at 0–0.
- A league game can finish 2–0, 1–1 or 0–2. A win gives two league points; a draw gives one to each team. Rankings use league points, point difference, points scored, then stable team-ID order.
- Seven teams play 21 league games in 11 rounds, initially estimated to end at 14:30 including ten five-minute breaks. Every pair plays once.
- The top four qualify. Court 1 has semifinal 1 (1st versus 4th), semifinal 2 (2nd versus 3rd), then the final, sequentially.
- All semifinals, the final and placement games are first to TWO set wins. The original plan was 25/25/15, win by two. Score entry now accepts completed sets as actually played, including spontaneous changes to the target or winning margin. These games cannot draw, and each saved completed set must be untied.
- On Court 2, the bottom three play a fresh three-match round robin for places 5–7. League results are not carried over. Placement ranking uses the existing match-points and rally-point tie breakers.
- There is no third-place match. The semifinal losers share third place: final ranks are 1, 2, =3, =3, 5, 6, 7.
- The later set-based games have 40-minute planning estimates, not hard time limits. The initial seven-team finish estimate is 16:45: 50 minutes of league breaks and 15 more minutes for later breaks and delays. League delays shift this estimate.

There are no public mode banners, detailed rule paragraphs, or dynamic game-mode/playoff-rule controls. The organiser does not need to change settings before entering shorter or extended scores. The target values exposed by /api/state are the original planning defaults, not score-entry limits. Earlier historical plans about groups, 25-minute slots or configurable formats are superseded.

# Six-team fallback and referee assignments

Before any game starts or any score exists, Admin offers Teams & setup and a dedicated Six-team fallback section. Select the missing team and explicitly confirm rebuilding the schedule. The remaining names, IDs and logos are preserved. There are 15 league games in eight slots, then two semifinals, one final and one 5th-versus-6th game: 19 games overall. The same scoring rules apply. Final ranks are 1, 2, =3, =3, 5, 6.

Each league match has one resting team assigned as referee. Seven teams have exactly three league referee duties each; six teams have two or three. A team cannot play or referee simultaneously on both courts.

For Court 1, semifinal 1 uses league seed 2 as referee, semifinal 2 uses the loser of semifinal 1, and the final uses the loser of semifinal 2. In the seven-team placement round, the third placement team referees each match. In the six-team fallback, league seed 3 referees the 5th-versus-6th match.

Six-team operational dependency: play 5th versus 6th alongside semifinal 1 and FINISH it before semifinal 2 starts, because seed 3 then plays semifinal 2. The organiser manages that timing; merely opening a score form does not mark a match active.

# Admin behavior and score corrections

Score entry retains the existing rows, Save result and Back. Opening the form or using Back is read-only. Save result accepts one completed set and leaves unplayed rows blank. Partial matches are stored as active; reopening the form restores their scores. Timed games finish after both sets, while playoffs and placements finish after two set wins. Score entry accepts 15–12, 29–27 and other scores actually played without target/margin validation. It still rejects tied completed sets, incomplete pairs, non-integers, gaps and a third set after 2–0. A correction to an already completed game must remain a complete result.

Completed games have Edit result. A corrected league result recalculates the league and reseeds affected pending semifinals and placement games. Correcting a semifinal winner updates the pending final and pending referee dependencies. A correction is refused if it would replace a participant in an already active, scored or completed dependent game. Harmless corrections that leave those participants unchanged remain allowed. Unaffected played games retain IDs, orientation, scores and historical referees.

Score forms carry version guards. Corrections and bracket updates commit atomically in both SQLite and D1, with rollback and stale-write protection. If bracket advancement fails after saving a result, the result remains saved and Admin provides a retry action.

Before play, teams can be added, removed, replaced and edited within the six/seven-team limit, and the schedule can be reset/regenerated with explicit confirmation. Those actions are blocked after any active/completed game or saved score. Logo updates remain available during the tournament.

Admin prioritizes active games, then the next games ready for score entry; completed history is collapsed below. Active games block conflicting courts, players and referees, rechecked in the score transaction. Scores uses one compact standings table with W/D/L and each team once. During playoffs, the top four retain labeled league seed/results rows; places 5–7 use separately labeled provisional placement results. Public playoff/placement and league history remains available in collapsed details. After every game is done, Scores and Admin display the winner, final set scores and all final standings at the top. Corrections update this summary automatically.

After a successful score save, the redirect to Admin carries a one-use notification marker. client.js sends a BroadcastChannel message and a storage-event fallback so another same-origin tab in the same browser reloads immediately, including hidden tabs. The marker is removed from the URL. Public pages also compare the /api/state X-Scores-Version header every five seconds while visible, reload only changed scores, pause polling while hidden and check immediately when visible again. Failed saves do not notify; temporary network failures keep the existing screen and retry. Admin forms never auto-refresh. QR code and Admin login remain separate pages. Logos retain their full aspect ratio; the public display uses compact sizes to fit every team.

# Code map

| File or folder | Responsibility |
| --- | --- |
| app.js | Shared Express routes, validation, setup, bracket advancement and state assembly, with injected database/icon adapters. |
| server.js | Local Node entry point; loads dotenv, SQLite, local icons and EJS views. |
| db.js | Local better-sqlite3 persistence, migrations/compatibility and atomic guards. |
| tournament.js | Fixed rules, round robin generation, balanced referees, winners and standings. |
| score-corrections.js | Plans corrected results, dependency changes and protection of played matches. |
| schedule-swaps.js | Plans exchanges of unplayed schedule slots and repairs affected referee duties. |
| presentation.js | UI helpers, court/queue ordering and finalResults completion/ranking logic. |
| cloudflare/worker.mjs | Cloudflare entry using nodejs_compat and cloudflare:node HTTP bridge. |
| cloudflare/database.mjs | Async D1 adapter with transactional batches and concurrency guards. |
| cloudflare/icons.mjs | Logos stored in D1 team_icons/icon_chunks; versioned cache URLs. |
| local-icons.js | Local filesystem logo adapter. |
| views/ | EJS public, Admin, score, setup, QR and print templates. _final_standings.ejs is the winner/overall-rankings partial. |
| public/style.css and public/client.js | Compact public display, immediate tab synchronization, version polling, image resizing/uploads and roster controls. |
| scripts/build-cloudflare.mjs | Compiles strict EJS templates and bundles the Worker with esbuild; copies only approved public assets. |
| scripts/build-domain-gateway.mjs | Builds the small Pages gateway and copies only style.css/client.js. |
| cloudflare/domain-gateway/ | Pages _worker.js and its separate wrangler.jsonc. |
| migrations/ | Production has 0001_initial through 0007_match_order. |
| *.test.js, *.test.mjs and test-support/ | Local, D1/Worker, gateway and shared correction tests. |
| DEPLOYMENT.md | Longer operational history and release notes. This handoff summarizes the latest state. |

Whenever adding an EJS partial or new template locals, update the viewLocals map in scripts/build-cloudflare.mjs. Local EJS rendering alone does not prove that strict compiled Worker templates work.

The public /api/state endpoint is read-only and returns teams, matches with sets, league/placement standings, mode and planning-default rules. Its X-Scores-Version header matches the version embedded in the public HTML and changes when tournament state changes. There is no separate frontend API project to deploy. The new views/_current_standings.ejs partial is included in the strict Cloudflare template build.

# Cloudflare resources and deployment

| Resource | Existing value |
| --- | --- |
| Account ID | 0e617072989f0ec7b25a41cbb3cbff41 |
| Worker/service name | petrus-volleyball |
| Worker version released 20 October | a66ffcc0-2fa6-43b0-b5ec-dcf6b99f1b13 |
| D1 binding | DB |
| D1 database name | petrus-volleyball |
| D1 database ID | b32936df-779b-4dbd-8e65-290ddae0236d |
| Pages project | petrus-volleyball |
| Latest Pages deployment | 61118e5d.petrus-volleyball.pages.dev |
| Pages service binding | TOURNAMENT points to petrus-volleyball Worker |
| Canonical BASE_URL | https://volleyball.florian-zug.de |
| Production admin secret name | ADMIN_PIN |

The main wrangler.jsonc builds dist/worker.mjs and serves dist/public. Compatibility date is 2026-09-18, with nodejs_compat. The Pages gateway serves style.css/client.js from its own assets and forwards all other requests to the same Worker through the TOURNAMENT binding. It preserves Host and X-Forwarded headers. Both hostnames use the SAME database, uploaded logos, password and results.

To deploy an authorized update from the project root:

```sh
npm ci
npm test
npm run test:cloudflare
npx wrangler login
npm run deploy:cloudflare
npm run deploy:domain
```

Migrations through 0007 are already applied in production. On any other existing environment, run `npx wrangler d1 migrations apply petrus-volleyball --remote` before deploying code that needs them; the nullable timestamp and match-order columns preserve existing data. The second deploy is required when CSS, client.js or gateway code changes, because the custom domain serves its own asset copies. The timing update changed Worker templates and server code, so it did not require a Pages asset deployment. Do not create a replacement D1 database, replace resources or reapply/reset production data as part of routine deployment.

Pages commands must use the dedicated cloudflare/domain-gateway configuration. The deploy:domain script already supplies --cwd, --project-name and --branch main. Running a Pages project-create command from the root previously caused Wrangler to delegate to a Worker deployment. The Pages project already exists. Do not add account_id to the Pages config.

# DNS and QR code

The user kept the existing DNS provider. Nameservers are ns1.tldns.net and ns2.tldns.net. The user replaced the previous volleyball A/AAAA record with CNAME volleyball -> petrus-volleyball.pages.dev. Do not move the domain's nameservers.

Cloudflare Pages domain association ID is 47e180d2-d290-49ee-a227-ed394d92eaea. Domain verification and certificate validation were active, and valid HTTPS was checked. BASE_URL and QR codes use https://volleyball.florian-zug.de. Preserve this canonical URL on future deployments.

The Windows resolver temporarily cached the old A record 84.19.26.106. When diagnosing propagation, query fresh public DNS and retain normal TLS verification. Do not disable certificate checks or change system DNS as a workaround. HTTPS was successfully verified with fresh DNS; the user-facing browser also opened the custom domain normally.

# MacBook setup and credentials

Clone https://github.com/Speedy0197/vbtournament into a normal Mac folder and read HANDOFF.md and DEPLOYMENT.md. The repository contains the application, tests, package-lock.json and deployment configuration. Actual environment files, databases, build output and authentication tokens are excluded. The private ChatGPT handoff at https://chatgpt.com/space/page_4aac776fda748191b37ac45e8be2237d also includes an earlier source ZIP and a readable implementation attachment.

Use Node 22 or 24 LTS and run npm ci on the Mac so better-sqlite3 is installed for macOS. Do not copy Windows node_modules. For local Express development:

```sh
git clone https://github.com/Speedy0197/vbtournament.git
cd vbtournament
npm ci
ADMIN_PIN=local-preview BASE_URL=http://localhost:3000 PORT=3000 npm start
```

local-preview is an example local-only password, not the production secret. A new local database starts without the production roster/results; configure the six/seven teams in local Admin. For the Worker emulator, copy .dev.vars.example to .dev.vars, choose a local password, run npm run db:local, then npm run dev:cloudflare. Neither local environment file changes the production secret.

Deployment from the Mac requires signing in to the Cloudflare account that owns the resources. Existing Windows Wrangler authentication is not transferred. The admin password is already set as the production ADMIN_PIN secret and was intentionally not included in any handoff file. The user knows it. No minimum password length is enforced. To deliberately change it, use npx wrangler secret put ADMIN_PIN and have the user enter the chosen password privately.

Opening this handoff gives context; it does not connect another chat to the Windows filesystem or grant Cloudflare access. The Mac needs the cloned source plus its own authenticated deployment tooling to make changes.

# Verification and current limits

The 16 October adaptive-timing release passed 120 tests (83 local and 37 Cloudflare/gateway). The maintenance worktree adds shared SQLite/D1 scenarios for partial-set saving, changed point targets, delayed bracket advancement, active-game conflicts including referee changes, stale forms, one-row-per-team standings, and successful-save notifications. Client tests cover immediate broadcasts, storage fallback, blocked storage, hidden tabs, polling and network retries. Coverage also includes synchronized league times, longer breaks, unchanged correction timestamps, six- and seven-team events, correction dependencies, rollback and restart persistence. Run both verification commands before deploying. Error traces from deliberately injected rollback/advancement failures are expected in passing test output.

Maintenance verification on 20 October includes the newer adaptive-timing commits from main. All 141 tests passed: 96 local and 45 compiled Cloudflare/D1/gateway tests. Both deployment asset builds succeeded. The timing test closes its SQLite connection before removing temporary files on Windows, and shared SQLite/D1 scenarios ensure a partial set leaves completed_at null. In an isolated local browser demo, saving one 15–12 semifinal set triggered the second tab's page request 72 ms after the score POST completed, with no intervening state poll. All seven standings rows were visible in the desktop browser check. Production data was not used for this demo.

After release, read-only checks confirmed HTTPS 200 for scores, QR, login and state; new CSS on the custom domain; and production state exactly unchanged. Earlier rehearsals also covered every possible missing-team fallback. Desktop and phone layouts were checked during UI work; actual venue connectivity and the organiser's own phone remain practical checks.

Printing currently shows the league table, league schedule, playoff/placement results and placement table. The new combined winner/final-standings summary is on Scores and Admin, not yet on the print page. There is no offline result-entry/synchronization system; use a printed schedule and a shared external timer at the venue.

# Windows-only finished demo

The existing isolated demo is http://127.0.0.1:57244/ with Admin at /admin. It has all 27 games completed. Its script is D:/vbtournament/.superpowers/after-league-current.cjs and its preserved SQLite database is D:/vbtournament/.superpowers/after-league-p7BXnq/demo.db. Those localhost URLs and files do not automatically exist on the Mac. No demo database or production database is in the source ZIP.

The demo's final standings are Blockwürstchen first, Halb Netz Halb Aus second, Hochball and Grüne Gurken joint third, Petrus Team 26 fifth, Netzflüsterer sixth and Netzfetzer seventh.

- Semifinal 1: Blockwürstchen beats Hochball 2–1 (25–21, 22–25, 16–14).
- Semifinal 2: Halb Netz Halb Aus beats Grüne Gurken 2–0 (Grüne first: 23–25, 21–25).
- Final: Blockwürstchen beats Halb Netz Halb Aus 2–1 (25–22, 23–25, 15–13).
- Placement: Petrus Team 26 beats Netzfetzer 2–1 (25–2, 15–25, 15–3); this unusual example was entered by the user and preserved.
- Placement: Petrus Team 26 beats Netzflüsterer 2–0 (25–20, 25–21).
- Placement: Netzflüsterer beats Netzfetzer 2–0 (Netzfetzer first: 20–25, 22–25).

These are demonstration results, not actual tournament results. If recreating the demo on the Mac, seed only a new local/emulator database and never POST sample scores to the production hostname.

# Continuing work

The user approved and requested deployment of upcoming-match swapping and the revised Admin layout on 20 October, with a commit to main and push. Both Worker and Pages assets are deployed, and migration 0007 is applied without resetting data. The custom domain, admin password, teams, logos and complete results are preserved. This follows the earlier maintenance release that preserved the score form, enabled single-set saves and immediate screen updates, and retained W/D/L with each public team listed once. On future requests, read the current code/state, change only what was requested and verify both Node and compiled Cloudflare behavior.

A starting prompt for a new ChatGPT conversation:

```text
Continue maintenance of my Petrus Volleyball tournament app at https://github.com/Speedy0197/vbtournament. Read HANDOFF.md and DEPLOYMENT.md, then inspect the implementation and current tournament rules. The latest released code is on main. Treat the live tournament database as authoritative and keep demo scores local. Tell me what access is available on this Mac before attempting deployment. My next request is: ...
```
