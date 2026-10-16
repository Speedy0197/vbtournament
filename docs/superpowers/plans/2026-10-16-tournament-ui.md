# Tournament UI implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session. User approved implementation and Cloudflare deployment.

**Goal:** Deploy the approved Courts first UI, complete-result score entry, and safe pre-play team/setup management.
**Architecture:** Keep Express/EJS and shared SQLite/D1 adapters. Reuse small team, court and standings partials, with pure presentation helpers. Roster changes and schedule rebuilding commit atomically.
**Tech Stack:** Node, Express, EJS, SQLite, Cloudflare Workers/D1.
**Spec:** Approved visual companion ui-review-v4.html plus the user's Save result / Back instruction.

## Constraints
- Preserve production teams, logos, schedule, referee duties and admin secret during deployment.
- Fixed six/seven-team league: two 10-minute sets; later matches best of three 25/25/15, win by two.
- Public scores show no format/rules paragraph; QR and login remain separate.
- Visiting score entry and Back do not mark games active or modify data.
- Save result rejects incomplete or invalid results without changing persisted scores.
- Pre-play roster editing and regeneration require explicit reset confirmation, current roster version, no active/completed game and no saved sets.
- No additional mode/rule editors, dependencies, backup, or unrelated commits.

## Review focus
- Extra third set after 2–0 and missing third set after 1–1.
- Stale roster submission and concurrent first score must not erase results.
- Removing/replacing teams must retain other IDs and logos.
- Long team names and wide logos must fit at 320–390 px.
- Compiled Worker templates must receive every shared view helper/partial local.

## Tasks
- [x] Add behavioral regressions for read-only entry, complete results and atomic roster changes; observe failures.
- [x] Implement complete-result scoring and atomic setup mutations in both adapters.
- [x] Implement responsive public, admin, score, setup, QR, login and print views matching the approved design.
- [x] Adapt existing event-flow tests for final-only results; run local and Cloudflare suites.
- [x] Review, inspect desktop/phone UI locally, deploy, verify unchanged live state and live UI.
- [x] Update deployment documentation with verification evidence and Worker version.

Ruling: Continue in the existing workspace because the deployed app consists of existing uncommitted work in this chat. Do not detach it into a checkout that omits those files.
Ruling: The instruction to implement and deploy authorizes proceeding without another skill-specific approval gate.

Review fixes: result saves survive an advancement error and expose a retry; new point-result submissions must end at the target or above the target with exactly a two-point lead. Regression tests first failed for both issues.

Release: f16b0dbb-f94a-4da1-8b08-8c1bcd84c465 deployed. 57 local + 18 Cloudflare tests passed. Live API records were identical before/after apart from the new read-only referee_icon field. Live score entry and Back left all21games pending.
