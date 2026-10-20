# Petrus Volleyball deployment

The fixed tournament for **17 October 2026** is live at [volleyball.florian-zug.de](https://volleyball.florian-zug.de). Admin: [/admin](https://volleyball.florian-zug.de/admin). QR code: [/qr](https://volleyball.florian-zug.de/qr). The original Workers address and [Pages gateway](https://petrus-volleyball.pages.dev) remain available.

Worker version: `a66ffcc0-2fa6-43b0-b5ec-dcf6b99f1b13`, deployed 20 October 2026. Pages deployment: `61118e5d.petrus-volleyball.pages.dev`. Migrations 0001–0007 are applied.

## Latest release · upcoming-match swapping and Admin cleanup

Admin offers **Swap upcoming matches**, collapsed below **Awaiting results**. Two league games, two semifinals or two placement games can exchange slots only while both are pending and have no saved sets. Games retain their IDs, participants, scores and finish timestamps. Court, order and labels move with the slots; affected referee duties follow the new schedule. Conflicting league swaps and cross-phase swaps are refused. Score corrections preserve the chosen order while updating seeded participants and bracket dependencies. Stale forms and concurrent saves are protected in both database adapters.

Admin now shows one collapsed combined standings table, listing each team once, instead of a separate places 5–7 table and repeated league standings. Completed tournaments show their final standings without the additional provisional table.

All 167 tests passed (109 local and 58 compiled Cloudflare/D1/gateway). Migration `0007_match_order.sql` adds nullable `matches.schedule_order`, retaining original ID order for every existing game. It was applied before deploying the Worker; Worker and Pages assets were then published using the existing resources and secret. Live read-only verification on the custom domain, Workers address and Pages address confirmed matching CSS/client assets, all seven final standings rows, working scores/login/QR pages and all logos accessible. Every pre-existing API state field is identical to the pre-release snapshot: seven teams, 27 completed games and 55 saved sets. All 27 new schedule-order values are null, and the database foreign-key check is clean. No sample scores, schedule reset or credential changes were made.

## Earlier release · single-set saving and immediate score updates

Source commit `e54e622ea48d5ba65774b5d9fb0973d44973a3fc` is on main. Score entry keeps the same rows, Save result and Back, while allowing a completed set to be saved with later rows blank. Shorter or extended sets such as 15–12 and 29–27 are accepted without editing rule settings. Partial matches stay active; their completion timestamp remains unset and dependent games wait for the complete match result. Atomic conflict and stale-form checks remain in both persistence adapters.

The public display uses one compact current standings table with W/D/L and each team once, including places 5–7. A committed score save sends a BroadcastChannel notification with a storage-event fallback to immediately refresh same-origin tabs in the same browser. Other devices compare the score version every five seconds while visible and refresh only after a change. Admin forms do not auto-refresh. Five-minute breaks and adaptive league timing from the newer main commits are preserved.

All 141 tests passed: 96 local SQLite/client/UI tests and 45 compiled Cloudflare/D1/gateway tests. An isolated browser demo measured the second tab's request 72 ms after a successful score POST, with no intervening poll. Worker and Pages assets were both deployed using `npm run deploy:cloudflare` and `npm run deploy:domain`. Read-only live verification on the custom domain, Workers and Pages hosts confirmed matching client/CSS asset hashes, the five-second refresh marker and matching state-version headers, seven final-standing rows and working scores/login/QR routes. All seven logos were accessible on the custom domain. The entire production state was identical before and after deployment: seven teams, 27 completed matches and 55 sets. No production scores, secrets, schedule or database schema were changed.

## Earlier release · public timing text cleanup

Removed the explanatory timing sentence below “Next on court” and the visible “Auto-refresh · every 2 min” label from public Scores. Automatic refresh remains enabled every 120 seconds, and the manual Refresh scores button remains. All 37 Cloudflare/D1/gateway tests and both client refresh tests passed. Live verification confirmed the label is gone, the refresh marker and client script remain, and the complete `/api/state` response is identical before and after deployment: seven teams, 21 pending matches and no saved sets. Demo results and their simulated delay remain local. No database migration or Pages deployment was required.

## Five-minute breaks and adaptive timing

The user approved five-minute breaks between league rounds. The deployed update projects the next round five minutes after both court results are saved, using the later timestamp and retaining at least 20 minutes of play per round. Longer breaks carry forward after the following round is scored. Result corrections keep their original timestamp. The public page, Admin, score entry, print and API use the same projected timetable; readings never rebuild pairings or modify stored matches.

Initial league finish estimates are 14:30 for seven teams and 13:15 for six. The existing 65-minute allowance now includes the 50/35 minutes of scheduled league breaks, leaving 15/30 minutes of additional reserve. Initial overall finish estimates remain 16:45/15:45 and shift with league delays.

Verified before deployment: 83 Node/SQLite tests and 37 Cloudflare/D1/gateway tests passed. The user signed in on this Mac, and migration 0006 and the Worker were deployed successfully. Live verification confirmed the five-minute gaps, 14:30 league finish, 16:45 overall planning estimate, HTTPS 200 for scores/login/QR and all seven logos. Existing team IDs, match IDs, pairings, referees, rules, statuses and scores were identical before and after deployment: seven teams, 21 pending matches, no saved sets.

The production deployment used:

```sh
npx wrangler d1 migrations apply petrus-volleyball --remote
npm run deploy:cloudflare
```

Migration 0006 adds nullable `matches.completed_at` and preserves existing results. Do not regenerate the live schedule. No CSS/client.js/gateway assets changed, so no Pages deploy was needed. The adaptive-timing source, migration, regression tests and release notes are versioned together in this repository. The release history below describes the previously deployed timetable.

## Tournament format

The registered teams are Grüne Gurken, Hochball, Halb Netz Halb Aus, Netzfetzer, Netzflüsterer, Blockwürstchen and Petrus Team 26. The live schedule was previously generated at the user's request. The UI release preserved all seven team IDs and uploaded logos, all 21 match IDs and pairings, scores and referee assignments.

- One league: 21 games, six games per team, across two courts.
- Eleven 20-minute rounds from 10:00 to an initial 14:30 finish, including five-minute breaks between rounds. Each game has two separate 10-minute sets, switching sides immediately. Saved completion times can shift the remaining estimates.
- Finish the rally at the buzzer. Any lead wins a timed set; if tied, play one deciding rally. Reset to 0–0 for set two. A 2–0 win earns two league points; a 1–1 draw earns one each. Rank by league points, point difference, points scored, then team registration order.
- Court 1 then runs semifinal 1 (1st vs 4th), semifinal 2 (2nd vs 3rd), and the final.
- Court 2 hosts a fresh round robin for places 5–7: each pair plays once.
- All semifinals, the final and placement games require two set wins. The planning defaults are 25 / 25 / 15, win by two; score entry accepts the completed sets actually played when rulings change. A 1–1 split remains active until the deciding set is complete.
- Later matches have a planning estimate of 40 minutes each. With 65 minutes reserved for breaks and delays, the seven-team estimate finishes at 16:45. Set-based games have no time limit.

There are no mode choices or editable playoff rules. Admin test-data tools have been removed. The Teams & setup page supports roster editing, adding/replacing/removing teams and rebuilding the schedule before play starts. Saving requires an explicit reset confirmation and a current roster version. Existing team IDs and logos are retained for teams that remain. Detailed rules remain hidden from the public scores page.

## Six-team fallback

Before play starts, open **Six-team fallback · a team is missing** in Admin, select the absent team, tick the confirmation, and submit.

This removes only the missing team and generates 15 league games with balanced referee duties. Remaining team IDs, names and logos stay intact. Each team plays five league games. The top four still reach the same semifinals and final on Court 1; fifth and sixth play one best-of-three match on Court 2. There are 19 matches overall, eight league slots, and an estimated finish of 15:45 including the same reserve.

Withdrawal is available only with seven teams and no active games, completed games or saved scores. Eligibility is rechecked atomically in both SQLite and D1. A second withdrawal is unavailable.

**Schedule management** can generate or regenerate the fixed schedule before play starts. Regeneration requires confirmation and keeps names and logos. It is blocked after play starts, including when a paused match has saved scores.

## UI and team setup

The public page starts with the next game on each court. Team logos use their full aspect ratio: 60–64 pixels in desktop standings and 80 pixels in court cards, with responsive phone sizes. The format banner and repeated public rules text are removed. Points are emphasized; phone standings retain W/D/L as a compact team record. A full league schedule is expandable below the main view.

Admin prioritizes the court score buttons. Teams & setup and print are directly accessible. QR Code and Admin login remain separate pages. The print layout has separate time, court, matchup, referee and result columns.

Before any game is active or any scores exist, Teams & setup can edit the roster and regenerate the schedule for six or seven teams. Remove a team to make room for a replacement; six is the minimum and seven the maximum. Save teams & regenerate schedule commits the roster and new matches atomically. Reset & regenerate schedule uses the currently saved roster. Both actions require confirmation. Stale roster forms and concurrent score saves cannot discard current data. Logo upload remains available after play starts; unsaved roster changes must be saved before uploading.

## Referees and scoring

Every league game has a third team refereeing while idle on both courts. With seven teams, each team has exactly three league referee duties. No team can play or referee two simultaneous active games.

Court 1 semifinal 1 uses the second league seed as referee; semifinal 2 uses the loser of semifinal 1; the final uses the loser of semifinal 2. Correcting semifinal 1 refreshes semifinal 2's referee while semifinal 2 remains pending and unscored. Court 2 uses the third placement team; the six-team fallback uses the third league seed, subject to availability.

Score entry has only **Save result** and **Back**. Opening a score form or returning with Back never marks a match active or saves anything. Save result accepts one completed set with later rows blank, keeping the match active until both timed sets or two playoff/placement set wins are recorded. The deciding third set fields remain available. Scores reflect the points actually played, including spontaneous target changes; tied sets, incomplete pairs, non-integers, gaps and an extra third set after 2–0 are rejected. Completed-game corrections must remain complete. Saved results survive a failed bracket-creation attempt, with a retry action in Admin.

Completed games have an **Edit result** action. Corrected league results recalculate standings and reseed affected pending semifinals and placement games. Correcting a semifinal winner updates a pending final and, where still pending, semifinal 2’s referee. A correction is rejected if it would replace a participant in an active, scored or completed dependent game. Unaffected played games retain their match IDs, team orientation, scores and historical referee. Corrections that leave later participants unchanged remain available. Open score forms include a version check; stale forms and concurrent bracket writes cannot overwrite newer teams or results. Correction and bracket changes commit atomically in SQLite and D1, with rollback on failure. The complete schedule, including pending matches and referee duties, is available at [/admin/print](https://petrus-volleyball.post8070.workers.dev/admin/print).

## Verification

All **100 tests passed**: 71 local, 28 Cloudflare integration tests and one domain-gateway integration test. Coverage includes complete seven-team and six-team event flows, deciding sets, refusal of placement draws, fixed-rule enforcement, removed mutation routes, atomic withdrawal/regeneration guards and rollback, referee corrections, dependency-aware score corrections, stale-form/concurrent-write protection, rollback, compiled templates, migrations, uploads and restart persistence. Obsolete tests for removed dynamic formats were replaced with fixed-event coverage.

The deployment dry run and independent code review passed. Desktop and 390-pixel phone layouts were visually checked using an isolated local copy with the real team logos. The Courts first public page, Admin match desk, score entry and pre-play setup were also checked on the deployed site. Live verification confirmed 21 unique pending league games, six games and three referee duties per team, no slot conflicts, fixed rules, all seven unchanged and accessible uploaded logos, and no foreign-key violations. Public scores, login, health and QR routes returned 200.

## Final readiness check · 16 October 2026

Fresh verification passed all 57 local tests and 18 Cloudflare tests. Eight additional full-event rehearsals used the compiled Worker and isolated D1 storage: the seven-team event and each of the seven possible missing-team scenarios. Together they completed 160 matches, including 34 deciding third sets across semifinals, finals and placement matches. Incomplete playoff results and one-point deciding-set margins were rejected without changing data. League schedules contained every pairing once, with no simultaneous player/referee conflicts; seven teams had three referee duties each, six teams had two or three. Remaining IDs and logo paths survived every withdrawal.

For the six-team event, play fifth versus sixth on Court 2 alongside semifinal 1 and finish it before semifinal 2 starts. The third league seed referees that placement match and then plays semifinal 2. This timing dependency is managed by the organiser; opening a result form does not mark a game active.

Live read-only checks confirmed the released Worker version at 100%, all seven logos and public routes accessible, authenticated Admin and its fallback controls available, and all 21 league games still pending with no saved scores. Production state was identical before and after the checks. Audit details are stored locally in `.superpowers/final-readiness-report.json`.

## Score-correction release · 16 October 2026

The browser demo corrected the completed Netzfetzer–Hochball league result after bracket seeding. Saving updated semifinal 1 from Blockwürstchen–Netzfetzer to Blockwürstchen–Hochball and updated Court 2 placement games and referee assignments. This was performed only in the isolated local demo at `http://127.0.0.1:57244/`.

New shared tests exercise the same correction behavior against local SQLite and the compiled Cloudflare Worker/D1, including six-team fallback, preservation of unrelated placement results, completed and partially scored dependent games, third-set semifinal corrections, stale forms, stale database writers and atomic rollback. An additional HTTP concurrency regression proves two simultaneous advancement requests cannot restore an old semifinal winner to the final. Independent review found no remaining actionable issues. The production release requires no new migration. Worker version `d2b20259-932d-4de2-b931-2e20c6b8da67` was deployed successfully. Live read-only verification confirmed all public routes and logos accessible and production state exactly unchanged: seven teams and 21 pending games.

## Admin queue and custom domain · 16 October 2026

Admin shows the next unscored game on each unfinished court, then an Awaiting results queue. Active games and games ready for entry precede games waiting for an earlier game on their court. Completed games are collapsed below the queue and retain Edit result. The public scores page and print schedule retain their playing order.

The DNS provider stays unchanged. A separate Cloudflare Pages project `petrus-volleyball` fronts the existing Worker through its `TOURNAMENT` service binding, preserving the same D1 database, admin secret, results and uploaded logos. Only style.css and client.js are copied as Pages assets. The gateway preserves the public Host and HTTPS scheme so the QR fallback uses the correct origin.

The user added `volleyball CNAME petrus-volleyball.pages.dev` at the external DNS provider. Cloudflare custom domain association ID: `47e180d2-d290-49ee-a227-ed394d92eaea`. Cloudflare reports the domain, ownership verification and certificate validation active. Valid HTTPS was confirmed using fresh public DNS, and the canonical `BASE_URL=https://volleyball.florian-zug.de` was deployed. QR images on the Worker, Pages gateway and custom hostname encode the custom URL. Some recursive DNS resolvers retain the former A record until its original one-hour TTL expires. No nameservers were changed.

Deploy the backend with `npm run deploy:cloudflare`. If gateway code or public assets change, also run `npm run deploy:domain`. The latter uses the dedicated Pages config in `cloudflare/domain-gateway`; run Pages commands from that directory so Wrangler does not delegate a new Pages project command to a Workers deployment in the root folder.

## Winner and final standings · 16 October 2026

After every league, semifinal, final and placement match has a completed result, Scores and Admin show the winner with the final set scores and overall standings for every team at the top. The public league table and coming-up panel are replaced. The final determines first and second; both semifinal losers share third because there is no third-place match. The independent placement round determines fifth through seventh, or fifth and sixth in the fallback. Admin keeps completed-game correction controls and a collapsed league table below the summary. Result corrections automatically update the winner and final standings.

The complete six- and seven-team flows were verified against SQLite and the compiled Cloudflare Worker/D1, including incomplete placement rounds and a corrected final winner. All 100 tests passed. The preserved local demo at http://127.0.0.1:57244/ shows the completed seven-team view with the existing sample scores. Worker version `d63bccc7-1450-44f1-bb2b-8c20923e0301` and Pages deployment `e0078731.petrus-volleyball.pages.dev` were released. Valid HTTPS, the new styles and canonical QR URL were checked on the custom hostname. Live data remained exactly unchanged: seven teams and 21 pending league matches.

## Development and updates

The app supports local Node/SQLite and Cloudflare Workers/D1. Public scores refresh every two minutes while visible; **Refresh scores** updates immediately. Admin forms never refresh automatically.

Use Node 22 or 24 LTS:

```sh
npm ci
npm test
npm run test:cloudflare
npx wrangler deploy --dry-run
npm run deploy:cloudflare
```

Cloudflare integration tests use isolated emulator storage. `npm start` uses the local SQLite database and local environment configuration. `wrangler.jsonc` already points to the production Worker and D1 database; do not create a replacement database for updates.

For local Worker development, copy `.dev.vars.example` to `.dev.vars`, choose a non-empty admin password, run `npm run db:local`, then `npm run dev:cloudflare`.

The existing production `ADMIN_PIN` secret was preserved. To change it, use `npx wrangler secret put ADMIN_PIN` and enter the password privately at the prompt. There is no minimum length. Local `.dev.vars` does not change the production secret.

Only `dist/public/style.css` and `dist/public/client.js` are published as static assets. Logos are stored in D1 with versioned caching; browser uploads resize photos automatically. Local databases, environment files and secrets are excluded from the assets bundle.

No manual database backup or paid service was added. Cloudflare usage remains subject to the configured account plan; see the official [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
