# Print Standings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Print Standings" button to the admin dashboard that opens a print-optimized page and triggers the browser print dialog.

**Architecture:** A new `GET /admin/print` route (protected by `requireAdmin`) renders a standalone EJS page with embedded light-mode CSS. The admin dashboard gets a new button linking to this route with `target="_blank"`. No new logic or dependencies are needed.

**Tech Stack:** Express.js, EJS, vanilla CSS `@media print`

---

## File Map

- **Modify:** `server.js` — add `GET /admin/print` route after existing admin routes
- **Create:** `views/admin/print.ejs` — standalone print page (no shared `_header`/`_footer`)
- **Modify:** `views/admin/index.ejs` — add print button to the action button row

_Note: The test suite (`tournament.test.js`) covers pure logic functions only, not routes. This feature is route + view with no new logic, so there is nothing to unit test. Verification is manual._

---

### Task 1: Add the `/admin/print` route

**Files:**
- Modify: `server.js` (add route before `app.listen` at line 264)

- [ ] **Step 1: Open `server.js` and locate the admin dashboard route**

  Find the block starting at line 176:
  ```javascript
  // ── Admin Dashboard ───────────────────────────────────────────────────────────
  app.get('/admin', requireAdmin, (req, res) => {
  ```

- [ ] **Step 2: Add the print route immediately after the closing `});` of the `/admin` GET handler (around line 182)**

  Insert this block:
  ```javascript
  // ── Print ─────────────────────────────────────────────────────────────────────
  app.get('/admin/print', requireAdmin, (req, res) => {
    const { matches, standings } = buildState();
    const bracketMatches = matches.filter(m => m.phase !== 'group');
    res.render('admin/print', { standings, bracketMatches });
  });
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add server.js
  git commit -m "feat: add /admin/print route"
  ```

---

### Task 2: Create the print view

**Files:**
- Create: `views/admin/print.ejs`

- [ ] **Step 1: Create `views/admin/print.ejs` with the following content**

  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Standings – Petrus Volleyball Turnier</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, -apple-system, sans-serif; background: #fff; color: #000; padding: 24px; }
      h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 4px; }
      .meta { font-size: 0.8rem; color: #555; margin-bottom: 24px; }
      .section { margin-bottom: 28px; }
      h2 { font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #444; border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 12px; }
      .groups { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
      h3 { font-size: 0.9rem; font-weight: 700; margin-bottom: 6px; }
      table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
      th { text-align: left; padding: 5px 8px; border-bottom: 1px solid #000; font-weight: 600; }
      td { padding: 6px 8px; border-bottom: 1px solid #ddd; }
      .rank { width: 28px; text-align: center; }
      .advance td { font-weight: 700; }
      .bracket-item { padding: 5px 0; border-bottom: 1px solid #ddd; font-size: 0.85rem; }
      .bracket-item:last-child { border-bottom: none; }
      .bracket-label { font-size: 0.72rem; color: #666; }
      .no-print { margin-top: 28px; }
      button { padding: 8px 16px; cursor: pointer; font-size: 0.85rem; }
      @media print { .no-print { display: none; } }
    </style>
  </head>
  <body>
    <h1>🏐 Petrus Volleyball Turnier</h1>
    <p class="meta">Printed: <%= new Date().toLocaleString('de-DE') %></p>

    <div class="section">
      <h2>Group Standings</h2>
      <div class="groups">
        <% ['A', 'B'].forEach(g => { %>
        <div>
          <h3>Group <%= g %></h3>
          <table>
            <thead>
              <tr>
                <th class="rank">#</th>
                <th>Team</th>
                <th>W</th>
                <th>L</th>
                <th>Sets</th>
              </tr>
            </thead>
            <tbody>
              <% (standings[g] || []).forEach((s, i) => { %>
              <tr class="<%= i < 2 ? 'advance' : '' %>">
                <td class="rank"><%= i + 1 %></td>
                <td><%= s.team.name %></td>
                <td><%= s.wins %></td>
                <td><%= s.losses %></td>
                <td><%= s.setsWon %>–<%= s.setsLost %></td>
              </tr>
              <% }); %>
            </tbody>
          </table>
        </div>
        <% }); %>
      </div>
    </div>

    <% if (bracketMatches.length > 0) { %>
    <div class="section">
      <h2>Bracket</h2>
      <% for (const m of bracketMatches) { %>
      <div class="bracket-item">
        <div class="bracket-label"><%= m.label || m.phase.replace(/_/g, ' ').toUpperCase() %></div>
        <div>
          <%= m.team1_name %> vs <%= m.team2_name %>
          <% if (m.sets && m.sets.length > 0) { %>
          &nbsp;(<%= m.sets.map(s => `${s.team1_score}–${s.team2_score}`).join(' | ') %>)
          <% } %>
          <% if (m.status === 'done') { %>
          &nbsp;✓
          <% } %>
        </div>
      </div>
      <% } %>
    </div>
    <% } %>

    <div class="no-print">
      <button onclick="window.close()">Close tab</button>
    </div>

    <script>window.print();</script>
  </body>
  </html>
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add views/admin/print.ejs
  git commit -m "feat: add print standings view"
  ```

---

### Task 3: Add the print button to the admin dashboard

**Files:**
- Modify: `views/admin/index.ejs` (line 7–8, the action button row `<div style="display:flex;gap:10px;...">`)

- [ ] **Step 1: Open `views/admin/index.ejs` and find the button row (line 7)**

  Current content of the button row div (starts at line 7):
  ```html
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px">
    <a href="/admin/setup" class="btn btn-sm">⚙️ Edit Teams</a>
  ```

- [ ] **Step 2: Add the print button as the first item in the button row**

  Change the button row opening to:
  ```html
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px">
    <a href="/admin/print" target="_blank" class="btn btn-sm btn-secondary">🖨️ Print Standings</a>
    <a href="/admin/setup" class="btn btn-sm">⚙️ Edit Teams</a>
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add views/admin/index.ejs
  git commit -m "feat: add print standings button to admin dashboard"
  ```

---

### Task 4: Manual verification

- [ ] **Step 1: Start the server**

  ```bash
  node server.js
  ```
  Expected: `Running on http://localhost:3000`

- [ ] **Step 2: Log in to the admin panel**

  Open `http://localhost:3000/admin/login`, enter the PIN (default: `1234`).

- [ ] **Step 3: Click "Print Standings"**

  The button should open a new tab at `/admin/print`. The page should:
  - Show a white background with dark text
  - Display Group A and Group B standings tables
  - Show a timestamp (e.g., `17.6.2026, 14:32:00`)
  - Display bracket results if any matches exist beyond the group stage
  - Automatically trigger the browser print dialog
  - Have a "Close tab" button visible on screen that disappears when printing

- [ ] **Step 4: Verify auth protection**

  Open a private/incognito window and navigate directly to `http://localhost:3000/admin/print`. You should be redirected to `/admin/login`.
