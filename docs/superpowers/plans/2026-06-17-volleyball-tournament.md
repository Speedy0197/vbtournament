# Volleyball Tournament Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a volleyball tournament website with admin PIN-protected score entry, live public scoreboard, TV display, and QR code access — for 10–12 teams, Groups → Double Bracket (Gold/Silver), Best of 3 sets (25/25/15).

**Architecture:** Node.js + Express serves EJS-templated HTML pages and a JSON `/api/state` endpoint. SQLite (better-sqlite3) stores teams, matches, and set scores. Public pages reload every 10 seconds. Admin routes are protected by a PIN in an env var. Bracket matches are auto-created when preceding rounds complete.

**Tech Stack:** Node.js 18+, Express 4, better-sqlite3, EJS, qrcode, cookie-parser. Deployed to Railway.

---

## File Map

```
server.js              – Express app: all routes, auth middleware, bracket advancement
db.js                  – SQLite connection, schema, all query functions
tournament.js          – Pure functions: getMatchWinner, calculateStandings, generateRoundRobin
tournament.test.js     – Unit tests for tournament.js (node:test)
public/
  style.css            – All styles (mobile-first, dark TV mode)
  client.js            – Auto-refresh (location.reload every 10s on live pages)
views/
  _header.ejs          – HTML <head> + <header> + <nav>
  _footer.ejs          – Closing tags + script includes
  index.ejs            – Public scoreboard
  tv.ejs               – TV full-screen display
  qr.ejs               – QR code display
  login.ejs            – Admin login form
  admin/
    index.ejs          – Admin dashboard (all matches)
    setup.ejs          – Team entry form
    match.ejs          – Score entry form
.env                   – ADMIN_PIN, BASE_URL (not committed)
.gitignore
railway.toml
```

---

## Task 1: Scaffold & Database Layer

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env`
- Create: `railway.toml`
- Create: `db.js`
- Create: `server.js` (stub — enough to start)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "vbtournament",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test tournament.test.js"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "cookie-parser": "^1.4.6",
    "dotenv": "^16.4.5",
    "ejs": "^3.1.9",
    "express": "^4.18.2",
    "qrcode": "^1.5.3"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Create .gitignore**

```
node_modules/
tournament.db
.env
.superpowers/
```

- [ ] **Step 4: Create .env**

```
ADMIN_PIN=1234
BASE_URL=http://localhost:3000
PORT=3000
```

- [ ] **Step 5: Create railway.toml**

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "node server.js"
healthcheckPath = "/"
healthcheckTimeout = 30
```

- [ ] **Step 6: Create db.js**

```javascript
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'tournament.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    group_name TEXT NOT NULL CHECK(group_name IN ('A', 'B'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phase TEXT NOT NULL CHECK(phase IN ('group', 'gold_sf', 'silver_sf', 'gold_final', 'silver_final')),
    court INTEGER,
    team1_id INTEGER REFERENCES teams(id),
    team2_id INTEGER REFERENCES teams(id),
    label TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'done'))
  );

  CREATE TABLE IF NOT EXISTS sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    set_number INTEGER NOT NULL CHECK(set_number IN (1, 2, 3)),
    team1_score INTEGER NOT NULL DEFAULT 0,
    team2_score INTEGER NOT NULL DEFAULT 0,
    UNIQUE(match_id, set_number)
  );
`);

const getTeams = () =>
  db.prepare('SELECT * FROM teams ORDER BY group_name, name').all();

const insertTeam = (name, group) =>
  db.prepare('INSERT OR IGNORE INTO teams (name, group_name) VALUES (?, ?)').run(name, group);

const clearAll = () => {
  db.prepare('DELETE FROM sets').run();
  db.prepare('DELETE FROM matches').run();
  db.prepare('DELETE FROM teams').run();
};

const getFullState = () => {
  const teams = db.prepare('SELECT * FROM teams ORDER BY group_name, id').all();
  const matches = db.prepare(`
    SELECT m.*, t1.name AS team1_name, t2.name AS team2_name
    FROM matches m
    LEFT JOIN teams t1 ON m.team1_id = t1.id
    LEFT JOIN teams t2 ON m.team2_id = t2.id
    ORDER BY m.id
  `).all();
  for (const match of matches) {
    match.sets = db.prepare(
      'SELECT * FROM sets WHERE match_id = ? ORDER BY set_number'
    ).all(match.id);
  }
  return { teams, matches };
};

const getMatchWithSets = (id) => {
  const match = db.prepare(`
    SELECT m.*, t1.name AS team1_name, t2.name AS team2_name
    FROM matches m
    LEFT JOIN teams t1 ON m.team1_id = t1.id
    LEFT JOIN teams t2 ON m.team2_id = t2.id
    WHERE m.id = ?
  `).get(id);
  if (!match) return null;
  match.sets = db.prepare(
    'SELECT * FROM sets WHERE match_id = ? ORDER BY set_number'
  ).all(id);
  return match;
};

const insertMatch = (phase, court, team1Id, team2Id, label) =>
  db.prepare(
    'INSERT INTO matches (phase, court, team1_id, team2_id, label) VALUES (?, ?, ?, ?, ?)'
  ).run(phase, court, team1Id, team2Id, label);

const updateMatchStatus = (id, status) =>
  db.prepare('UPDATE matches SET status = ? WHERE id = ?').run(status, id);

const clearMatches = () => {
  db.prepare('DELETE FROM sets').run();
  db.prepare('DELETE FROM matches').run();
};

const upsertSet = (matchId, setNumber, team1Score, team2Score) =>
  db.prepare(`
    INSERT INTO sets (match_id, set_number, team1_score, team2_score)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(match_id, set_number) DO UPDATE SET
      team1_score = excluded.team1_score,
      team2_score = excluded.team2_score
  `).run(matchId, setNumber, team1Score, team2Score);

const deleteSetsForMatch = (matchId) =>
  db.prepare('DELETE FROM sets WHERE match_id = ?').run(matchId);

module.exports = {
  getTeams,
  insertTeam,
  clearAll,
  getFullState,
  getMatchWithSets,
  insertMatch,
  updateMatchStatus,
  clearMatches,
  upsertSet,
  deleteSetsForMatch,
};
```

- [ ] **Step 7: Create server.js stub**

```javascript
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/health', (req, res) => res.send('ok'));

app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
```

- [ ] **Step 8: Verify the server starts**

```bash
node server.js
```

Expected output: `Running on http://localhost:3000`  
Visit http://localhost:3000/health → `ok`  
A `tournament.db` file should appear in the project root.

Press Ctrl+C to stop.

- [ ] **Step 9: Commit**

```bash
git init
git add package.json package-lock.json .gitignore railway.toml db.js server.js
git commit -m "feat: project scaffold, db schema, and query layer"
```

---

## Task 2: Tournament Logic (TDD)

**Files:**
- Create: `tournament.js`
- Create: `tournament.test.js`

- [ ] **Step 1: Write failing tests for getMatchWinner**

Create `tournament.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getMatchWinner, calculateStandings, generateRoundRobin } = require('./tournament');

// getMatchWinner
test('2-0: team1 wins', () => {
  const sets = [
    { team1_score: 25, team2_score: 18 },
    { team1_score: 25, team2_score: 20 },
  ];
  assert.equal(getMatchWinner(sets), 1);
});

test('2-1: team2 wins', () => {
  const sets = [
    { team1_score: 25, team2_score: 18 },
    { team1_score: 18, team2_score: 25 },
    { team1_score: 12, team2_score: 15 },
  ];
  assert.equal(getMatchWinner(sets), 2);
});

test('0-2: team2 wins', () => {
  const sets = [
    { team1_score: 18, team2_score: 25 },
    { team1_score: 20, team2_score: 25 },
  ];
  assert.equal(getMatchWinner(sets), 2);
});

test('1-1: no winner yet', () => {
  const sets = [
    { team1_score: 25, team2_score: 18 },
    { team1_score: 18, team2_score: 25 },
  ];
  assert.equal(getMatchWinner(sets), null);
});

test('empty sets: no winner', () => {
  assert.equal(getMatchWinner([]), null);
});

// calculateStandings
test('standings: win/loss counts', () => {
  const teams = [
    { id: 1, name: 'Alpha', group_name: 'A' },
    { id: 2, name: 'Beta', group_name: 'A' },
  ];
  const matches = [
    {
      id: 1, phase: 'group', team1_id: 1, team2_id: 2, status: 'done',
      sets: [
        { team1_score: 25, team2_score: 18 },
        { team1_score: 25, team2_score: 20 },
      ],
    },
  ];
  const standings = calculateStandings(teams, matches);
  assert.equal(standings[0].team.id, 1); // Alpha won
  assert.equal(standings[0].wins, 1);
  assert.equal(standings[0].losses, 0);
  assert.equal(standings[1].team.id, 2); // Beta lost
  assert.equal(standings[1].wins, 0);
  assert.equal(standings[1].losses, 1);
});

test('standings: set ratio tiebreaker', () => {
  const teams = [
    { id: 1, name: 'Alpha', group_name: 'A' },
    { id: 2, name: 'Beta', group_name: 'A' },
    { id: 3, name: 'Gamma', group_name: 'A' },
  ];
  // Both Alpha and Beta have 1 win each, but Alpha has better set ratio
  const matches = [
    {
      id: 1, team1_id: 1, team2_id: 3, status: 'done',
      sets: [{ team1_score: 25, team2_score: 10 }, { team1_score: 25, team2_score: 10 }],
    },
    {
      id: 2, team1_id: 2, team2_id: 3, status: 'done',
      sets: [{ team1_score: 25, team2_score: 23 }, { team1_score: 23, team2_score: 25 }, { team1_score: 15, team2_score: 10 }],
    },
    {
      id: 3, team1_id: 1, team2_id: 2, status: 'done',
      sets: [{ team1_score: 18, team2_score: 25 }, { team1_score: 20, team2_score: 25 }],
    },
  ];
  const standings = calculateStandings(teams, matches);
  // Alpha: 1W-1L, set ratio 2:2 = 1.0
  // Beta: 2W-0L (wait - Beta beat Gamma AND Alpha... let me re-check)
  // Actually: Alpha beats Gamma 2-0, Beta beats Gamma 2-1, Beta beats Alpha 2-0
  // Alpha: 1W 1L, sets 2:2
  // Beta: 2W 0L, sets 4:1
  // Gamma: 0W 2L
  assert.equal(standings[0].team.id, 2); // Beta first
  assert.equal(standings[0].wins, 2);
});

// generateRoundRobin
test('round robin produces n*(n-1)/2 pairs', () => {
  const pairs = generateRoundRobin([1, 2, 3, 4, 5]);
  assert.equal(pairs.length, 10); // 5*4/2
});

test('round robin: all unique pairs', () => {
  const pairs = generateRoundRobin([1, 2, 3]);
  assert.deepEqual(pairs.sort(), [[1, 2], [1, 3], [2, 3]].sort());
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test
```

Expected: errors like `Cannot find module './tournament'`

- [ ] **Step 3: Implement tournament.js**

```javascript
function getMatchWinner(sets) {
  let t1Sets = 0, t2Sets = 0;
  for (const s of sets) {
    if (s.team1_score > s.team2_score) t1Sets++;
    else if (s.team2_score > s.team1_score) t2Sets++;
  }
  if (t1Sets === 2) return 1;
  if (t2Sets === 2) return 2;
  return null;
}

function calculateStandings(teams, matches) {
  const stats = {};
  for (const team of teams) {
    stats[team.id] = {
      team,
      wins: 0, losses: 0,
      setsWon: 0, setsLost: 0,
      pointsFor: 0, pointsAgainst: 0,
    };
  }

  for (const match of matches) {
    const winner = getMatchWinner(match.sets || []);
    if (!winner) continue;

    const winnerId = winner === 1 ? match.team1_id : match.team2_id;
    const loserId  = winner === 1 ? match.team2_id : match.team1_id;
    if (!stats[winnerId] || !stats[loserId]) continue;

    stats[winnerId].wins++;
    stats[loserId].losses++;

    for (const s of (match.sets || [])) {
      stats[match.team1_id].setsWon     += s.team1_score > s.team2_score ? 1 : 0;
      stats[match.team1_id].setsLost    += s.team2_score > s.team1_score ? 1 : 0;
      stats[match.team2_id].setsWon     += s.team2_score > s.team1_score ? 1 : 0;
      stats[match.team2_id].setsLost    += s.team1_score > s.team2_score ? 1 : 0;
      stats[match.team1_id].pointsFor   += s.team1_score;
      stats[match.team1_id].pointsAgainst += s.team2_score;
      stats[match.team2_id].pointsFor   += s.team2_score;
      stats[match.team2_id].pointsAgainst += s.team1_score;
    }
  }

  return Object.values(stats).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aSetR = a.setsLost ? a.setsWon / a.setsLost : a.setsWon;
    const bSetR = b.setsLost ? b.setsWon / b.setsLost : b.setsWon;
    if (Math.abs(bSetR - aSetR) > 0.0001) return bSetR - aSetR;
    const aPtsR = a.pointsAgainst ? a.pointsFor / a.pointsAgainst : a.pointsFor;
    const bPtsR = b.pointsAgainst ? b.pointsFor / b.pointsAgainst : b.pointsFor;
    return bPtsR - aPtsR;
  });
}

function generateRoundRobin(teamIds) {
  const pairs = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      pairs.push([teamIds[i], teamIds[j]]);
    }
  }
  return pairs;
}

module.exports = { getMatchWinner, calculateStandings, generateRoundRobin };
```

- [ ] **Step 4: Run tests — verify they all pass**

```bash
npm test
```

Expected: all tests pass, no failures.

- [ ] **Step 5: Commit**

```bash
git add tournament.js tournament.test.js
git commit -m "feat: tournament logic with passing tests"
```

---

## Task 3: EJS Partials & CSS

**Files:**
- Create: `views/_header.ejs`
- Create: `views/_footer.ejs`
- Create: `public/style.css`

- [ ] **Step 1: Create directories**

```bash
mkdir -p views/admin public
```

- [ ] **Step 2: Create views/_header.ejs**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><%= typeof title !== 'undefined' ? title + ' – ' : '' %>🏐 VB Tournament</title>
  <link rel="stylesheet" href="/style.css">
  <% if (typeof refresh !== 'undefined' && refresh) { %>
  <meta http-equiv="refresh" content="10">
  <% } %>
</head>
<body class="<%= typeof bodyClass !== 'undefined' ? bodyClass : '' %>">
<% if (typeof hideNav === 'undefined' || !hideNav) { %>
<header class="site-header">
  <a href="/" class="site-title">🏐 VB Tournament</a>
  <nav>
    <a href="/">Scores</a>
    <a href="/tv">TV</a>
    <a href="/qr">QR Code</a>
    <a href="/admin" class="admin-link">Admin</a>
  </nav>
</header>
<% } %>
<main>
```

- [ ] **Step 3: Create views/_footer.ejs**

```html
</main>
<script src="/client.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create public/style.css**

```css
:root {
  --blue: #2563eb;
  --gold: #d97706;
  --silver: #6b7280;
  --green: #16a34a;
  --red: #dc2626;
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: #e2e8f0;
  --text: #0f172a;
  --muted: #64748b;
  --radius: 8px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
a { color: var(--blue); text-decoration: none; }
a:hover { text-decoration: underline; }

/* Header */
.site-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: var(--blue); color: white; }
.site-header a { color: white; }
.site-title { font-weight: 700; font-size: 1.1rem; }
nav { display: flex; gap: 16px; font-size: 0.9rem; }
.admin-link { opacity: 0.7; font-size: 0.8rem; }

/* Layout */
main { max-width: 900px; margin: 0 auto; padding: 20px 16px; }
.page-title { font-size: 1.4rem; font-weight: 700; margin-bottom: 20px; }
.section-title { font-size: 1rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 24px 0 10px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 600px) { .grid-2 { grid-template-columns: 1fr; } }

/* Cards */
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
.card + .card { margin-top: 8px; }

/* Match card */
.match-card { display: flex; align-items: center; gap: 12px; }
.match-teams { flex: 1; }
.match-vs { font-size: 0.8rem; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.match-vs::before, .match-vs::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.team-name { font-weight: 600; font-size: 0.95rem; }
.team-score { font-size: 1.5rem; font-weight: 700; min-width: 40px; text-align: center; }
.match-meta { font-size: 0.75rem; color: var(--muted); }
.sets-display { font-size: 0.8rem; color: var(--muted); margin-top: 4px; }

/* Status badges */
.badge { display: inline-block; font-size: 0.7rem; font-weight: 600; padding: 2px 8px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.05em; }
.badge-live { background: #fef2f2; color: var(--red); border: 1px solid #fca5a5; }
.badge-done { background: #f0fdf4; color: var(--green); border: 1px solid #86efac; }
.badge-pending { background: #f8fafc; color: var(--muted); border: 1px solid var(--border); }
.badge-gold { background: #fffbeb; color: var(--gold); border: 1px solid #fcd34d; }
.badge-silver { background: #f8fafc; color: var(--silver); border: 1px solid #d1d5db; }

/* Standings table */
.standings-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.standings-table th { text-align: left; padding: 6px 8px; color: var(--muted); font-weight: 500; border-bottom: 2px solid var(--border); }
.standings-table td { padding: 8px 8px; border-bottom: 1px solid var(--border); }
.standings-table tr:last-child td { border-bottom: none; }
.standings-table .rank { font-weight: 700; color: var(--muted); width: 28px; }
.standings-table .team-col { font-weight: 600; }
.standings-table .num { text-align: center; }
.standings-table .advance { color: var(--gold); font-weight: 700; }
.standings-table .silver-zone { color: var(--silver); font-weight: 700; }

/* Forms */
.form-group { margin-bottom: 12px; }
label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 4px; }
input[type="text"], input[type="number"], input[type="password"], select {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius);
  font-size: 0.95rem; background: var(--surface); color: var(--text);
}
input[type="number"] { width: 72px; text-align: center; font-size: 1.2rem; font-weight: 700; }
.btn { display: inline-block; padding: 10px 20px; background: var(--blue); color: white; border: none; border-radius: var(--radius); font-size: 0.95rem; font-weight: 600; cursor: pointer; text-decoration: none; }
.btn:hover { background: #1d4ed8; text-decoration: none; }
.btn-sm { padding: 6px 12px; font-size: 0.8rem; }
.btn-danger { background: var(--red); }
.btn-secondary { background: var(--muted); }

/* Score entry */
.score-entry-header { display: flex; align-items: center; justify-content: space-between; font-size: 1.3rem; font-weight: 700; margin-bottom: 20px; }
.set-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.set-label { min-width: 60px; font-size: 0.85rem; color: var(--muted); font-weight: 500; }
.set-dash { font-size: 1.2rem; color: var(--muted); }
.score-actions { margin-top: 20px; display: flex; gap: 12px; align-items: center; }

/* Team setup grid */
.team-input-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin-bottom: 8px; align-items: center; }
.team-input-row select { width: auto; }

/* Admin match list */
.match-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 6px; }
.match-row-teams { font-weight: 600; flex: 1; }
.match-row-score { font-size: 0.9rem; color: var(--muted); margin: 0 16px; }
.match-row-actions { display: flex; gap: 8px; align-items: center; }

/* TV Display */
body.tv {
  background: #0f172a;
  color: #f1f5f9;
  font-size: 1.2rem;
}
body.tv main { max-width: 100%; padding: 24px; }
.tv-header { text-align: center; font-size: 2rem; font-weight: 800; margin-bottom: 32px; color: white; }
.tv-courts { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
.tv-court { background: #1e293b; border-radius: 12px; padding: 24px; text-align: center; }
.tv-court-label { font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; margin-bottom: 16px; }
.tv-match { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.tv-team { font-size: 1.6rem; font-weight: 700; flex: 1; }
.tv-team:last-child { text-align: right; }
.tv-score { font-size: 3rem; font-weight: 900; color: white; min-width: 80px; text-align: center; }
.tv-sets { font-size: 0.85rem; color: #94a3b8; margin-top: 8px; text-align: center; }
.tv-empty { color: #475569; font-style: italic; text-align: center; padding: 20px; }
.tv-standings { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.tv-group-title { font-size: 1rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; margin-bottom: 12px; }
.tv-standing-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #334155; font-size: 1rem; }
.tv-standing-rank { width: 28px; font-weight: 700; color: #64748b; }
.tv-standing-name { flex: 1; font-weight: 600; }
.tv-standing-wl { color: #94a3b8; font-size: 0.9rem; }
.tv-bracket-label { text-align: center; font-size: 0.75rem; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }

/* QR page */
.qr-container { text-align: center; padding: 40px 0; }
.qr-container img { max-width: 280px; border-radius: var(--radius); background: white; padding: 12px; }
.qr-url { margin-top: 16px; font-size: 1.1rem; font-weight: 600; }

/* Alerts */
.alert { padding: 10px 14px; border-radius: var(--radius); margin-bottom: 16px; font-size: 0.9rem; }
.alert-info { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }

/* Login */
.login-box { max-width: 320px; margin: 60px auto; }
.login-box h1 { margin-bottom: 20px; }
```

- [ ] **Step 5: Create public/client.js**

Auto-refresh is handled via `<meta http-equiv="refresh" content="10">` injected by `_header.ejs` when `refresh: true` is passed. No client-side JS is needed for refresh. This file is a no-op placeholder so the script tag in `_footer.ejs` doesn't 404.

```javascript
// Refresh is handled server-side via meta refresh tag in _header.ejs
```

- [ ] **Step 6: Commit**

```bash
git add views/ public/ 
git commit -m "feat: EJS partials and CSS"
```

---

## Task 4: Admin Auth

**Files:**
- Create: `views/login.ejs`
- Modify: `server.js` (add auth middleware + login routes)

- [ ] **Step 1: Create views/login.ejs**

```html
<%- include('_header', { title: 'Admin Login', hideNav: true }) %>
<div class="login-box card">
  <h1>🔒 Admin Login</h1>
  <% if (typeof error !== 'undefined' && error) { %>
  <div class="alert alert-info"><%= error %></div>
  <% } %>
  <form method="POST" action="/admin/login">
    <div class="form-group">
      <label for="pin">PIN</label>
      <input type="password" id="pin" name="pin" autocomplete="current-password" autofocus>
    </div>
    <button type="submit" class="btn">Enter</button>
  </form>
</div>
<%- include('_footer') %>
```

- [ ] **Step 2: Add auth middleware and login routes to server.js**

Replace the stub `server.js` with the following (keep the existing `require` and `app.use` lines, add below them):

```javascript
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const db = require('./db');
const tournament = require('./tournament');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Auth ────────────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.cookies.admin === ADMIN_PIN) return next();
  res.redirect('/admin/login');
}

app.get('/admin/login', (req, res) => {
  res.render('login', {});
});

app.post('/admin/login', (req, res) => {
  if (req.body.pin === ADMIN_PIN) {
    res.cookie('admin', ADMIN_PIN, { httpOnly: true, sameSite: 'strict' });
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Wrong PIN' });
  }
});

app.get('/admin/logout', (req, res) => {
  res.clearCookie('admin');
  res.redirect('/');
});

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.send('ok'));

app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
```

- [ ] **Step 3: Test login flow**

```bash
node server.js
```

Visit http://localhost:3000/admin/login  
Enter wrong PIN → page reloads with "Wrong PIN"  
Enter `1234` → redirects to /admin (will 404 for now, that's fine)  
Press Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add views/login.ejs server.js
git commit -m "feat: admin PIN auth"
```

---

## Task 5: Team Setup

**Files:**
- Create: `views/admin/setup.ejs`
- Modify: `server.js` (add setup routes)

- [ ] **Step 1: Create views/admin/setup.ejs**

```html
<%- include('../_header', { title: 'Team Setup' }) %>
<h1 class="page-title">Team Setup</h1>

<% if (typeof message !== 'undefined' && message) { %>
<div class="alert alert-info"><%= message %></div>
<% } %>

<form method="POST" action="/admin/setup">
  <p style="color:var(--muted);font-size:0.85rem;margin-bottom:16px">
    Enter up to 12 teams. Leave name blank to skip that row. Saving this will reset all existing data.
  </p>

  <% for (let i = 0; i < 12; i++) { const t = teams[i] || {}; %>
  <div class="team-input-row">
    <input type="text" name="name" placeholder="Team <%= i + 1 %> name" value="<%= t.name || '' %>">
    <select name="group">
      <option value="A" <%= (t.group_name || (i < 6 ? 'A' : 'B')) === 'A' ? 'selected' : '' %>>Group A</option>
      <option value="B" <%= (t.group_name || (i < 6 ? 'A' : 'B')) === 'B' ? 'selected' : '' %>>Group B</option>
    </select>
  </div>
  <% } %>

  <div style="margin-top:20px;display:flex;gap:12px">
    <button type="submit" class="btn">Save Teams</button>
    <a href="/admin" class="btn btn-secondary">Cancel</a>
  </div>
</form>
<%- include('../_footer') %>
```

- [ ] **Step 2: Add setup routes to server.js** (add before `app.listen`)

```javascript
// ── Team Setup ───────────────────────────────────────────────────────────────
app.get('/admin/setup', requireAdmin, (req, res) => {
  const teams = db.getTeams();
  res.render('admin/setup', { teams });
});

app.post('/admin/setup', requireAdmin, (req, res) => {
  const names = [].concat(req.body.name || []);
  const groups = [].concat(req.body.group || []);

  const validTeams = names
    .map((name, i) => ({ name: name.trim(), group: groups[i] }))
    .filter(t => t.name.length > 0);

  db.clearAll();
  for (const t of validTeams) {
    db.insertTeam(t.name, t.group);
  }

  res.redirect('/admin/setup?saved=1');
});
```

Update the GET `/admin/setup` route to pass a message when `?saved=1`:

```javascript
app.get('/admin/setup', requireAdmin, (req, res) => {
  const teams = db.getTeams();
  const message = req.query.saved ? `${teams.length} teams saved.` : null;
  res.render('admin/setup', { teams, message });
});
```

- [ ] **Step 3: Test team setup**

```bash
node server.js
```

Login at http://localhost:3000/admin/login  
Go to http://localhost:3000/admin/setup  
Enter 5 teams in Group A and 5 in Group B → click Save  
Page reloads showing "10 teams saved."  
Press Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add views/admin/setup.ejs server.js
git commit -m "feat: team setup page"
```

---

## Task 6: Admin Dashboard & Schedule Generation

**Files:**
- Create: `views/admin/index.ejs`
- Modify: `server.js` (add admin index + generate-schedule routes)

- [ ] **Step 1: Create views/admin/index.ejs**

```html
<%- include('../_header', { title: 'Admin' }) %>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
  <h1 class="page-title" style="margin:0">Admin Dashboard</h1>
  <a href="/admin/logout" class="btn btn-secondary btn-sm">Logout</a>
</div>

<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px">
  <a href="/admin/setup" class="btn btn-sm">⚙️ Edit Teams</a>
  <% if (teams.length > 0 && groupMatches.length === 0) { %>
  <form method="POST" action="/admin/generate-schedule" style="display:inline">
    <button type="submit" class="btn btn-sm">📅 Generate Schedule</button>
  </form>
  <% } %>
  <% if (groupMatches.length > 0 && allGroupDone && bracketMatches.length === 0) { %>
  <form method="POST" action="/admin/advance-bracket" style="display:inline">
    <button type="submit" class="btn btn-sm" style="background:var(--gold)">🏆 Seed Bracket</button>
  </form>
  <% } %>
</div>

<% if (teams.length === 0) { %>
<div class="alert alert-info">No teams yet. <a href="/admin/setup">Add teams</a> to get started.</div>
<% } %>

<% if (groupMatches.length > 0) { %>
<p class="section-title">Group Stage</p>
<% for (const m of groupMatches) { %>
<%- include('../_match_row', { m }) %>
<% } %>
<% } %>

<% if (bracketMatches.length > 0) { %>
<p class="section-title">Bracket</p>
<% for (const m of bracketMatches) { %>
<%- include('../_match_row', { m }) %>
<% } %>
<% } %>
<%- include('../_footer') %>
```

- [ ] **Step 2: Create views/_match_row.ejs** (shared partial)

```html
<div class="match-row">
  <div class="match-row-teams">
    <%= m.team1_name || '?' %> vs <%= m.team2_name || '?' %>
    <% if (m.label) { %> <span class="badge badge-<%= m.phase.includes('gold') ? 'gold' : 'silver' %>"><%= m.label %></span><% } %>
    <% if (m.court) { %> <span class="badge badge-pending">Court <%= m.court %></span><% } %>
  </div>
  <div class="match-row-score">
    <% if (m.sets && m.sets.length > 0) { %>
      <%= m.sets.map(s => `${s.team1_score}–${s.team2_score}`).join(', ') %>
    <% } else { %>
      –
    <% } %>
  </div>
  <div class="match-row-actions">
    <span class="badge badge-<%= m.status %>"><%= m.status %></span>
    <a href="/admin/match/<%= m.id %>/score" class="btn btn-sm">Score</a>
  </div>
</div>
```

- [ ] **Step 3: Add admin routes to server.js**

```javascript
// ── Helper: build state ────────────────────────────────────────────────────
function buildState() {
  const { teams, matches } = db.getFullState();
  const teamsByGroup = {
    A: teams.filter(t => t.group_name === 'A'),
    B: teams.filter(t => t.group_name === 'B'),
  };
  const groupAIds = new Set(teamsByGroup.A.map(t => t.id));
  const groupBIds = new Set(teamsByGroup.B.map(t => t.id));
  const groupMatches = matches.filter(m => m.phase === 'group');
  const doneGroupA = groupMatches.filter(m => m.status === 'done' && groupAIds.has(m.team1_id));
  const doneGroupB = groupMatches.filter(m => m.status === 'done' && groupBIds.has(m.team1_id));
  const standings = {
    A: tournament.calculateStandings(teamsByGroup.A, doneGroupA),
    B: tournament.calculateStandings(teamsByGroup.B, doneGroupB),
  };
  return { teams, matches, standings, teamsByGroup };
}

// ── Admin Dashboard ────────────────────────────────────────────────────────
app.get('/admin', requireAdmin, (req, res) => {
  const { teams, matches, standings } = buildState();
  const groupMatches = matches.filter(m => m.phase === 'group');
  const bracketMatches = matches.filter(m => m.phase !== 'group');
  const allGroupDone = groupMatches.length > 0 && groupMatches.every(m => m.status === 'done');
  res.render('admin/index', { teams, groupMatches, bracketMatches, standings, allGroupDone });
});

// ── Schedule Generation ────────────────────────────────────────────────────
app.post('/admin/generate-schedule', requireAdmin, (req, res) => {
  const teams = db.getTeams();
  const groupA = teams.filter(t => t.group_name === 'A');
  const groupB = teams.filter(t => t.group_name === 'B');

  db.clearMatches();

  const pairsA = tournament.generateRoundRobin(groupA.map(t => t.id));
  const pairsB = tournament.generateRoundRobin(groupB.map(t => t.id));

  let court = 1;
  for (const [t1, t2] of pairsA) {
    db.insertMatch('group', court, t1, t2, null);
    court = court === 2 ? 1 : 2;
  }
  for (const [t1, t2] of pairsB) {
    db.insertMatch('group', court, t1, t2, null);
    court = court === 2 ? 1 : 2;
  }

  res.redirect('/admin');
});
```

- [ ] **Step 4: Test dashboard and schedule generation**

```bash
node server.js
```

Login, go to /admin/setup — add 5 teams to Group A and 5 to Group B.  
Go to /admin → click "Generate Schedule"  
Should see Group A (10 matches) + Group B (10 matches) listed.  
Press Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add views/admin/index.ejs views/_match_row.ejs server.js
git commit -m "feat: admin dashboard and round-robin schedule generation"
```

---

## Task 7: Score Entry & Bracket Advancement

**Files:**
- Create: `views/admin/match.ejs`
- Modify: `server.js` (score routes + `tryAdvanceBracket`)

- [ ] **Step 1: Create views/admin/match.ejs**

```html
<%- include('../_header', { title: 'Enter Score' }) %>
<a href="/admin" style="font-size:0.85rem;color:var(--muted)">← Back to Admin</a>

<div style="margin-top:16px">
  <div class="score-entry-header">
    <span><%= match.team1_name %></span>
    <span style="font-size:0.9rem;color:var(--muted)">vs</span>
    <span><%= match.team2_name %></span>
  </div>
  <% if (match.label) { %><p style="color:var(--muted);margin-bottom:16px"><%= match.label %></p><% } %>

  <form method="POST">
    <% const sets = match.sets; %>
    <% [1,2,3].forEach(n => { %>
    <% const s = sets.find(x => x.set_number === n) || {}; %>
    <div class="set-row">
      <span class="set-label">Set <%= n %><% if (n === 3) { %> <em style="font-size:0.75rem">(if needed)</em><% } %></span>
      <input type="number" name="s<%= n %>t1" min="0" max="30" value="<%= s.team1_score != null ? s.team1_score : '' %>" placeholder="–">
      <span class="set-dash">–</span>
      <input type="number" name="s<%= n %>t2" min="0" max="30" value="<%= s.team2_score != null ? s.team2_score : '' %>" placeholder="–">
    </div>
    <% }); %>

    <div class="score-actions">
      <button type="submit" class="btn">💾 Save Score</button>
      <a href="/admin" class="btn btn-secondary">Cancel</a>
    </div>
  </form>
</div>
<%- include('../_footer') %>
```

- [ ] **Step 2: Add bracket advancement helper to server.js**

Add this function before the routes:

```javascript
function tryAdvanceBracket() {
  const { teams, matches } = db.getFullState();
  const teamsByGroup = {
    A: teams.filter(t => t.group_name === 'A'),
    B: teams.filter(t => t.group_name === 'B'),
  };
  const groupAIds = new Set(teamsByGroup.A.map(t => t.id));
  const groupBIds = new Set(teamsByGroup.B.map(t => t.id));

  const groupMatches  = matches.filter(m => m.phase === 'group');
  const goldSFs       = matches.filter(m => m.phase === 'gold_sf');
  const silverSFs     = matches.filter(m => m.phase === 'silver_sf');
  const goldFinals    = matches.filter(m => m.phase === 'gold_final');
  const silverFinals  = matches.filter(m => m.phase === 'silver_final');

  // Seed Gold + Silver SFs when all group matches are done
  if (groupMatches.length > 0 && groupMatches.every(m => m.status === 'done') && goldSFs.length === 0) {
    const doneA = groupMatches.filter(m => groupAIds.has(m.team1_id));
    const doneB = groupMatches.filter(m => groupBIds.has(m.team1_id));
    const sA = tournament.calculateStandings(teamsByGroup.A, doneA);
    const sB = tournament.calculateStandings(teamsByGroup.B, doneB);

    // Gold SFs: A1 vs B2, B1 vs A2
    db.insertMatch('gold_sf',   1, sA[0].team.id, sB[1].team.id, 'Gold SF 1');
    db.insertMatch('gold_sf',   2, sB[0].team.id, sA[1].team.id, 'Gold SF 2');

    // Silver SFs: A3 vs B4, B3 vs A4 (guard against small groups)
    const a3 = sA[2], a4 = sA[3], b3 = sB[2], b4 = sB[3];
    if (a3 && b3) {
      db.insertMatch('silver_sf', 1, a3.team.id, (b4 || b3).team.id, 'Silver SF 1');
      db.insertMatch('silver_sf', 2, b3.team.id, (a4 || a3).team.id, 'Silver SF 2');
    }
    return;
  }

  // Gold Final when both Gold SFs done
  if (goldSFs.length === 2 && goldSFs.every(m => m.status === 'done') && goldFinals.length === 0) {
    const w1 = tournament.getMatchWinner(goldSFs[0].sets);
    const w2 = tournament.getMatchWinner(goldSFs[1].sets);
    if (w1 && w2) {
      const t1 = w1 === 1 ? goldSFs[0].team1_id : goldSFs[0].team2_id;
      const t2 = w2 === 1 ? goldSFs[1].team1_id : goldSFs[1].team2_id;
      db.insertMatch('gold_final', 1, t1, t2, 'Gold Final 🥇');
    }
  }

  // Silver Final when both Silver SFs done
  if (silverSFs.length === 2 && silverSFs.every(m => m.status === 'done') && silverFinals.length === 0) {
    const w1 = tournament.getMatchWinner(silverSFs[0].sets);
    const w2 = tournament.getMatchWinner(silverSFs[1].sets);
    if (w1 && w2) {
      const t1 = w1 === 1 ? silverSFs[0].team1_id : silverSFs[0].team2_id;
      const t2 = w2 === 1 ? silverSFs[1].team1_id : silverSFs[1].team2_id;
      db.insertMatch('silver_final', 1, t1, t2, 'Silver Final 🥈');
    }
  }
}
```

- [ ] **Step 3: Add score entry routes to server.js**

```javascript
// ── Score Entry ────────────────────────────────────────────────────────────
app.get('/admin/match/:id/score', requireAdmin, (req, res) => {
  const match = db.getMatchWithSets(Number(req.params.id));
  if (!match) return res.status(404).send('Match not found');
  if (match.status === 'pending') db.updateMatchStatus(match.id, 'active');
  res.render('admin/match', { match: db.getMatchWithSets(match.id) });
});

app.post('/admin/match/:id/score', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const match = db.getMatchWithSets(matchId);
  if (!match) return res.status(404).send('Match not found');

  const rawSets = [
    { n: 1, t1: req.body.s1t1, t2: req.body.s1t2 },
    { n: 2, t1: req.body.s2t1, t2: req.body.s2t2 },
    { n: 3, t1: req.body.s3t1, t2: req.body.s3t2 },
  ];

  const validSets = rawSets
    .filter(s => s.t1 !== '' && s.t2 !== '' && s.t1 != null && s.t2 != null)
    .map(s => ({ n: s.n, t1: parseInt(s.t1) || 0, t2: parseInt(s.t2) || 0 }));

  db.deleteSetsForMatch(matchId);
  for (const s of validSets) {
    db.upsertSet(matchId, s.n, s.t1, s.t2);
  }

  const winner = tournament.getMatchWinner(validSets.map(s => ({ team1_score: s.t1, team2_score: s.t2 })));
  db.updateMatchStatus(matchId, winner ? 'done' : 'active');

  if (winner) tryAdvanceBracket();

  res.redirect('/admin');
});

// Manual bracket seed button (admin can trigger early if needed)
app.post('/admin/advance-bracket', requireAdmin, (req, res) => {
  tryAdvanceBracket();
  res.redirect('/admin');
});
```

- [ ] **Step 4: Test score entry end-to-end**

```bash
node server.js
```

1. Login, setup 4 teams (2 per group), generate schedule.
2. Click "Score" on any match → enter `25 – 18` for Set 1, `25 – 20` for Set 2 → Save.
3. Match should show as `done` with scores displayed.
4. After all group matches done, "Seed Bracket" button should appear.
5. Click it → Gold SF and Silver SF matches appear.

Press Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add views/admin/match.ejs server.js
git commit -m "feat: score entry and auto bracket advancement"
```

---

## Task 8: API State Endpoint

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add GET /api/state to server.js**

```javascript
// ── API ───────────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  const { teams, matches, standings } = buildState();
  res.json({ teams, matches, standings });
});
```

- [ ] **Step 2: Verify JSON response**

```bash
node server.js
```

Visit http://localhost:3000/api/state  
Expected: JSON with `teams`, `matches`, `standings` keys.  
Press Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: /api/state JSON endpoint"
```

---

## Task 9: Public Scoreboard

**Files:**
- Create: `views/index.ejs`
- Modify: `server.js` (add GET /)

- [ ] **Step 1: Create views/index.ejs**

```html
<%- include('_header', { title: 'Scores', refresh: true }) %>

<% const liveMatches    = matches.filter(m => m.status === 'active'); %>
<% const groupMatches   = matches.filter(m => m.phase === 'group'); %>
<% const bracketMatches = matches.filter(m => m.phase !== 'group'); %>
<% const upcomingGroup  = groupMatches.filter(m => m.status === 'pending').slice(0, 6); %>

<% if (liveMatches.length > 0) { %>
<p class="section-title">🔴 Live Now</p>
<% for (const m of liveMatches) { %>
<div class="card match-card">
  <div class="match-teams">
    <div class="team-name"><%= m.team1_name %></div>
    <div class="match-vs">vs</div>
    <div class="team-name"><%= m.team2_name %></div>
  </div>
  <div>
    <% if (m.sets.length > 0) { %>
      <% for (const s of m.sets) { %>
      <div style="display:flex;gap:8px;align-items:center;margin:2px 0">
        <span class="team-score" style="font-size:1.1rem"><%= s.team1_score %></span>
        <span style="color:var(--muted)">–</span>
        <span class="team-score" style="font-size:1.1rem"><%= s.team2_score %></span>
        <span class="match-meta">Set <%= s.set_number %></span>
      </div>
      <% } %>
    <% } else { %>
      <span class="badge badge-live">Live</span>
    <% } %>
  </div>
</div>
<% } %>
<% } %>

<% if (bracketMatches.length > 0) { %>
<p class="section-title">🏆 Bracket</p>
<div class="grid-2">
  <div>
    <p style="font-size:0.8rem;font-weight:600;color:var(--gold);margin-bottom:8px">GOLD</p>
    <% for (const m of bracketMatches.filter(x => x.phase.includes('gold'))) { %>
    <div class="card" style="margin-bottom:6px">
      <div style="font-size:0.75rem;color:var(--muted);margin-bottom:6px"><%= m.label || m.phase.replace('_',' ').toUpperCase() %></div>
      <div style="font-weight:600"><%= m.team1_name %> <span style="color:var(--muted)">vs</span> <%= m.team2_name %></div>
      <% if (m.sets.length > 0) { %>
      <div class="sets-display"><%= m.sets.map(s => `${s.team1_score}–${s.team2_score}`).join(' | ') %></div>
      <% } %>
      <span class="badge badge-<%= m.status %>" style="margin-top:4px"><%= m.status %></span>
    </div>
    <% } %>
  </div>
  <div>
    <p style="font-size:0.8rem;font-weight:600;color:var(--silver);margin-bottom:8px">SILVER</p>
    <% for (const m of bracketMatches.filter(x => x.phase.includes('silver'))) { %>
    <div class="card" style="margin-bottom:6px">
      <div style="font-size:0.75rem;color:var(--muted);margin-bottom:6px"><%= m.label || m.phase.replace('_',' ').toUpperCase() %></div>
      <div style="font-weight:600"><%= m.team1_name %> <span style="color:var(--muted)">vs</span> <%= m.team2_name %></div>
      <% if (m.sets.length > 0) { %>
      <div class="sets-display"><%= m.sets.map(s => `${s.team1_score}–${s.team2_score}`).join(' | ') %></div>
      <% } %>
      <span class="badge badge-<%= m.status %>" style="margin-top:4px"><%= m.status %></span>
    </div>
    <% } %>
  </div>
</div>
<% } %>

<p class="section-title">Group Standings</p>
<div class="grid-2">
  <% ['A','B'].forEach(g => { %>
  <div>
    <p style="font-size:0.85rem;font-weight:600;margin-bottom:6px">Group <%= g %></p>
    <table class="standings-table">
      <thead><tr><th class="rank">#</th><th class="team-col">Team</th><th class="num">W</th><th class="num">L</th><th class="num">Sets</th></tr></thead>
      <tbody>
        <% (standings[g] || []).forEach((s, i) => { %>
        <tr>
          <td class="rank <%= i < 2 ? 'advance' : i < 4 ? 'silver-zone' : '' %>"><%= i + 1 %></td>
          <td class="team-col"><%= s.team.name %></td>
          <td class="num"><%= s.wins %></td>
          <td class="num"><%= s.losses %></td>
          <td class="num"><%= s.setsWon %>–<%= s.setsLost %></td>
        </tr>
        <% }); %>
      </tbody>
    </table>
  </div>
  <% }); %>
</div>

<% if (upcomingGroup.length > 0) { %>
<p class="section-title">Upcoming</p>
<% for (const m of upcomingGroup) { %>
<div class="card">
  <div style="font-weight:600"><%= m.team1_name %> vs <%= m.team2_name %></div>
  <% if (m.court) { %><div class="match-meta">Court <%= m.court %></div><% } %>
</div>
<% } %>
<% } %>

<p style="font-size:0.75rem;color:var(--muted);text-align:center;margin-top:32px">Refreshes every 10 seconds</p>
<%- include('_footer') %>
```

- [ ] **Step 2: Add GET / route to server.js**

```javascript
// ── Public Pages ──────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const { teams, matches, standings } = buildState();
  res.render('index', { teams, matches, standings });
});
```

- [ ] **Step 3: Test scoreboard**

```bash
node server.js
```

Visit http://localhost:3000/ — should see standings tables and upcoming matches.  
The page should auto-reload every 10 seconds (watch the browser tab title flash).  
Press Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add views/index.ejs server.js
git commit -m "feat: public scoreboard with standings and bracket"
```

---

## Task 10: TV Display

**Files:**
- Create: `views/tv.ejs`
- Modify: `server.js` (add GET /tv)

- [ ] **Step 1: Create views/tv.ejs**

```html
<%- include('_header', { title: 'TV Display', refresh: true, hideNav: true, bodyClass: 'tv' }) %>

<div class="tv-header">🏐 Volleyball Tournament</div>

<% const liveMatches = matches.filter(m => m.status === 'active'); %>
<% const courts = [1, 2]; %>

<div class="tv-courts">
  <% courts.forEach(court => { %>
  <div class="tv-court">
    <div class="tv-court-label">Court <%= court %></div>
    <% const courtMatch = liveMatches.find(m => m.court === court) || matches.find(m => m.court === court && m.status === 'pending'); %>
    <% if (courtMatch) { %>
    <div class="tv-match">
      <div class="tv-team"><%= courtMatch.team1_name %></div>
      <div>
        <% const setsW1 = (courtMatch.sets||[]).filter(s => s.team1_score > s.team2_score).length; %>
        <% const setsW2 = (courtMatch.sets||[]).filter(s => s.team2_score > s.team1_score).length; %>
        <div class="tv-score"><%= setsW1 %> – <%= setsW2 %></div>
        <div class="tv-sets">
          <% (courtMatch.sets||[]).forEach(s => { %>
          <span><%= s.team1_score %>–<%= s.team2_score %></span>&nbsp;
          <% }); %>
        </div>
        <div class="tv-bracket-label"><%= courtMatch.status === 'active' ? '🔴 LIVE' : 'NEXT' %></div>
      </div>
      <div class="tv-team"><%= courtMatch.team2_name %></div>
    </div>
    <% } else { %>
    <div class="tv-empty">No match scheduled</div>
    <% } %>
  </div>
  <% }); %>
</div>

<div class="tv-standings">
  <% ['A','B'].forEach(g => { %>
  <div>
    <div class="tv-group-title">Group <%= g %></div>
    <% (standings[g] || []).forEach((s, i) => { %>
    <div class="tv-standing-row">
      <span class="tv-standing-rank"><%= i + 1 %></span>
      <span class="tv-standing-name"><%= s.team.name %></span>
      <span class="tv-standing-wl"><%= s.wins %>W–<%= s.losses %>L</span>
    </div>
    <% }); %>
  </div>
  <% }); %>
</div>
<%- include('_footer') %>
```

- [ ] **Step 2: Add GET /tv route to server.js**

```javascript
app.get('/tv', (req, res) => {
  const { teams, matches, standings } = buildState();
  res.render('tv', { teams, matches, standings });
});
```

- [ ] **Step 3: Test TV display**

```bash
node server.js
```

Visit http://localhost:3000/tv — dark background, large text, court cards and standings.  
Press Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add views/tv.ejs server.js
git commit -m "feat: TV full-screen display"
```

---

## Task 11: QR Code Page

**Files:**
- Create: `views/qr.ejs`
- Modify: `server.js` (add GET /qr)

- [ ] **Step 1: Create views/qr.ejs**

```html
<%- include('_header', { title: 'QR Code' }) %>
<div class="qr-container">
  <h1 class="page-title">Scan to follow scores</h1>
  <img src="<%= qrDataUrl %>" alt="QR code for <%= baseUrl %>">
  <div class="qr-url"><%= baseUrl %></div>
  <p style="color:var(--muted);margin-top:12px;font-size:0.85rem">Points to the live scoreboard</p>
</div>
<%- include('_footer') %>
```

- [ ] **Step 2: Add GET /qr route to server.js**

```javascript
app.get('/qr', async (req, res) => {
  const qrDataUrl = await QRCode.toDataURL(BASE_URL, { width: 280, margin: 2 });
  res.render('qr', { qrDataUrl, baseUrl: BASE_URL });
});
```

- [ ] **Step 3: Test QR page**

```bash
node server.js
```

Visit http://localhost:3000/qr — should see a QR code image and the URL below it.  
Scan with phone → should open the scoreboard.  
Press Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add views/qr.ejs server.js
git commit -m "feat: QR code page"
```

---

## Task 12: Railway Deployment

**Files:**
- No new files — railway.toml already exists.

- [ ] **Step 1: Add dotenv load guard to server.js** (already done — `require('dotenv').config()` at top)

- [ ] **Step 2: Push repo to GitHub**

Create a new GitHub repo (e.g. `vbtournament`) then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/vbtournament.git
git push -u origin main
```

- [ ] **Step 3: Create Railway project**

1. Go to https://railway.app → New Project → Deploy from GitHub repo → select `vbtournament`
2. Railway will detect Node.js and use `npm start`

- [ ] **Step 4: Set environment variables in Railway dashboard**

In Railway → Variables tab, add:
```
ADMIN_PIN=your-secret-pin
BASE_URL=https://your-project.up.railway.app
```

The `PORT` variable is set automatically by Railway.

- [ ] **Step 5: Deploy and verify**

Railway will auto-deploy. Once green:
- Visit `https://your-project.up.railway.app/` → public scoreboard
- Visit `/admin/login` → login with your PIN
- Visit `/qr` → QR code points to the Railway URL

- [ ] **Step 6: Update BASE_URL in Railway env**

Copy the actual Railway URL shown in the dashboard and set it as `BASE_URL`.  
Trigger a redeploy (Railway → Deploy → Redeploy).

**Note:** SQLite lives on the Railway filesystem. Don't redeploy during the tournament — it will reset the database. Set up teams and generate the schedule the night before.

---

## Verification Checklist

Before tournament day, run through this end-to-end:

- [ ] Add 10 teams (5 per group) via /admin/setup
- [ ] Generate schedule — verify 10 matches per group appear
- [ ] Enter scores for 2–3 matches — verify standings update
- [ ] Complete all group matches for a test group — verify bracket seeding triggers automatically
- [ ] Enter Gold SF scores — verify Gold Final is created
- [ ] Open /tv on a second screen — verify it shows live courts
- [ ] Open / on a phone — verify it auto-refreshes every 10s
- [ ] Open /qr — scan with phone — verify it lands on /
