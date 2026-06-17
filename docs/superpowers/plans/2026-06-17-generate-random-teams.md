# Generate Random Teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Generate Random Teams" button to the admin setup page that fills 12 team name inputs with preset names and assigns each team a random emoji, stored in the existing `icon_path` column.

**Architecture:** Emoji characters are stored directly in the `icon_path` column (no schema change). The rendering convention is: `icon_path` starting with `/` → image file; `icon_path` set but no `/` prefix → emoji; neither → first letter. The generate button is client-side JS that shuffles a preset pool and fills the form; saving goes through the existing POST flow.

**Tech Stack:** Node.js, Express, EJS, better-sqlite3, node:test (built-in)

---

## File Map

| File | Change |
|------|--------|
| `db.js` | Extend `insertTeam` to accept optional `iconPath` param |
| `server.js` | Read `emoji` array in setup POST handler, pass to `insertTeam` |
| `views/admin/setup.ejs` | Add hidden emoji inputs, Generate button, inline JS |
| `views/admin/index.ejs` | Update icon rendering (2 locations) |
| `views/index.ejs` | Update icon rendering (1 location) |
| `views/tv.ejs` | Update icon rendering (1 location) |

---

## Task 1: Extend `insertTeam` and update the setup POST handler

**Files:**
- Modify: `db.js:44`
- Modify: `server.js:150-162`

- [ ] **Step 1: Update `insertTeam` in `db.js`**

Replace line 44:
```js
const insertTeam = (name, group) =>
  db.prepare('INSERT OR IGNORE INTO teams (name, group_name) VALUES (?, ?)').run(name, group);
```
With:
```js
const insertTeam = (name, group, iconPath = null) =>
  db.prepare('INSERT OR IGNORE INTO teams (name, group_name, icon_path) VALUES (?, ?, ?)').run(name, group, iconPath);
```

- [ ] **Step 2: Update setup POST handler in `server.js`**

Replace the `app.post('/admin/setup', ...)` handler (lines 150–162):
```js
app.post('/admin/setup', requireAdmin, (req, res) => {
  const names  = [].concat(req.body.name  || []);
  const groups = [].concat(req.body.group || []);
  const emojis = [].concat(req.body.emoji || []);
  const validTeams = names
    .map((name, i) => ({ name: name.trim(), group: groups[i], emoji: emojis[i] || null }))
    .filter(t => t.name.length > 0);
  try {
    for (const f of fs.readdirSync(uploadsDir)) fs.unlinkSync(path.join(uploadsDir, f));
  } catch (e) {}
  db.clearAll();
  for (const t of validTeams) db.insertTeam(t.name, t.group, t.emoji);
  res.redirect('/admin/setup?saved=1');
});
```

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```
node --test tournament.test.js
```

Expected: all tests pass (these test pure functions unrelated to DB).

- [ ] **Step 4: Commit**

```
git add db.js server.js
git commit -m "feat: extend insertTeam to accept iconPath for emoji support"
```

---

## Task 2: Update setup view — hidden inputs, Generate button, and JS

**Files:**
- Modify: `views/admin/setup.ejs`

- [ ] **Step 1: Add hidden emoji input to each team row**

In `views/admin/setup.ejs`, the team row loop currently looks like:
```ejs
<% for (let i = 0; i < 12; i++) { const t = teams[i] || {}; %>
<div class="team-input-row">
  <input type="text" name="name" placeholder="Team <%= i + 1 %> name" value="<%= t.name || '' %>">
  <select name="group">
    <option value="A" <%= (t.group_name || (i < 6 ? 'A' : 'B')) === 'A' ? 'selected' : '' %>>Group A</option>
    <option value="B" <%= (t.group_name || (i < 6 ? 'A' : 'B')) === 'B' ? 'selected' : '' %>>Group B</option>
  </select>
</div>
<% } %>
```

Replace it with (adds hidden emoji input per row):
```ejs
<% for (let i = 0; i < 12; i++) { const t = teams[i] || {}; %>
<div class="team-input-row">
  <input type="text" name="name" placeholder="Team <%= i + 1 %> name" value="<%= t.name || '' %>">
  <input type="hidden" name="emoji" value="<%= t.icon_path && !t.icon_path.startsWith('/') ? t.icon_path : '' %>">
  <select name="group">
    <option value="A" <%= (t.group_name || (i < 6 ? 'A' : 'B')) === 'A' ? 'selected' : '' %>>Group A</option>
    <option value="B" <%= (t.group_name || (i < 6 ? 'A' : 'B')) === 'B' ? 'selected' : '' %>>Group B</option>
  </select>
</div>
<% } %>
```

- [ ] **Step 2: Add the Generate button**

In `views/admin/setup.ejs`, the button row currently looks like:
```ejs
<div style="margin-top:20px;display:flex;gap:12px">
  <button type="submit" class="btn">Save Teams</button>
  <a href="/admin" class="btn btn-secondary">Cancel</a>
</div>
```

Replace it with:
```ejs
<div style="margin-top:20px;display:flex;gap:12px">
  <button type="submit" class="btn">Save Teams</button>
  <button type="button" class="btn btn-secondary" onclick="generateTeams()">🎲 Generate Random Teams</button>
  <a href="/admin" class="btn btn-secondary">Cancel</a>
</div>
```

- [ ] **Step 3: Add the inline JS block**

At the bottom of `views/admin/setup.ejs`, just before `<%- include('../_footer') %>`, add:

```ejs
<script>
function generateTeams() {
  const pool = [
    { name: 'Lions',    emoji: '🦁' },
    { name: 'Tigers',   emoji: '🐯' },
    { name: 'Eagles',   emoji: '🦅' },
    { name: 'Wolves',   emoji: '🐺' },
    { name: 'Foxes',    emoji: '🦊' },
    { name: 'Bears',    emoji: '🐻' },
    { name: 'Sharks',   emoji: '🦈' },
    { name: 'Dolphins', emoji: '🐬' },
    { name: 'Cobras',   emoji: '🐍' },
    { name: 'Leopards', emoji: '🐆' },
    { name: 'Rhinos',   emoji: '🦏' },
    { name: 'Flames',   emoji: '🔥' },
    { name: 'Thunder',  emoji: '⚡' },
    { name: 'Waves',    emoji: '🌊' },
    { name: 'Tornados', emoji: '🌪️' },
    { name: 'Falcons',  emoji: '🦋' },
  ];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const nameInputs  = document.querySelectorAll('input[name="name"]');
  const emojiInputs = document.querySelectorAll('input[name="emoji"]');
  for (let i = 0; i < 12; i++) {
    nameInputs[i].value  = pool[i].name;
    emojiInputs[i].value = pool[i].emoji;
  }
}
</script>
```

- [ ] **Step 4: Commit**

```
git add views/admin/setup.ejs
git commit -m "feat: add generate random teams button with emoji to setup page"
```

---

## Task 3: Update icon rendering in all views

The three-branch pattern to use everywhere:
- `icon_path` starts with `/` → image file
- `icon_path` set, no `/` prefix → emoji
- neither → first letter of team name

**Files:**
- Modify: `views/admin/index.ejs` (2 locations)
- Modify: `views/index.ejs` (1 location)
- Modify: `views/tv.ejs` (1 location)

- [ ] **Step 1: Update team list in `views/admin/index.ejs` (large icon, variable `t`)**

Find (lines 29–33):
```ejs
<% if (t.icon_path) { %>
<img src="<%= t.icon_path %>" alt="<%= t.name %>" class="team-icon team-icon-lg">
<% } else { %>
<span class="team-icon-placeholder team-icon-lg"><%= t.name.charAt(0).toUpperCase() %></span>
<% } %>
```

Replace with:
```ejs
<% if (t.icon_path && t.icon_path.startsWith('/')) { %>
<img src="<%= t.icon_path %>" alt="<%= t.name %>" class="team-icon team-icon-lg">
<% } else if (t.icon_path) { %>
<span class="team-icon-placeholder team-icon-lg"><%= t.icon_path %></span>
<% } else { %>
<span class="team-icon-placeholder team-icon-lg"><%= t.name.charAt(0).toUpperCase() %></span>
<% } %>
```

- [ ] **Step 2: Update standings table in `views/admin/index.ejs` (small icon, variable `s.team`)**

Find (line 68):
```ejs
<% if (s.team.icon_path) { %><img src="<%= s.team.icon_path %>" alt="" class="team-icon"><% } else { %><span class="team-icon-placeholder"><%= s.team.name.charAt(0).toUpperCase() %></span><% } %>
```

Replace with:
```ejs
<% if (s.team.icon_path && s.team.icon_path.startsWith('/')) { %><img src="<%= s.team.icon_path %>" alt="" class="team-icon"><% } else if (s.team.icon_path) { %><span class="team-icon-placeholder"><%= s.team.icon_path %></span><% } else { %><span class="team-icon-placeholder"><%= s.team.name.charAt(0).toUpperCase() %></span><% } %>
```

- [ ] **Step 3: Update standings in `views/index.ejs` (variable `s.team`)**

Find (line 85):
```ejs
<% if (s.team.icon_path) { %><img src="<%= s.team.icon_path %>" alt="" class="team-icon"><% } else { %><span class="team-icon-placeholder"><%= s.team.name.charAt(0).toUpperCase() %></span><% } %>
```

Replace with:
```ejs
<% if (s.team.icon_path && s.team.icon_path.startsWith('/')) { %><img src="<%= s.team.icon_path %>" alt="" class="team-icon"><% } else if (s.team.icon_path) { %><span class="team-icon-placeholder"><%= s.team.icon_path %></span><% } else { %><span class="team-icon-placeholder"><%= s.team.name.charAt(0).toUpperCase() %></span><% } %>
```

- [ ] **Step 4: Update standings in `views/tv.ejs` (variable `s.team`)**

Find (line 49):
```ejs
<% if (s.team.icon_path) { %><img src="<%= s.team.icon_path %>" alt="" class="team-icon"><% } else { %><span class="team-icon-placeholder"><%= s.team.name.charAt(0).toUpperCase() %></span><% } %>
```

Replace with:
```ejs
<% if (s.team.icon_path && s.team.icon_path.startsWith('/')) { %><img src="<%= s.team.icon_path %>" alt="" class="team-icon"><% } else if (s.team.icon_path) { %><span class="team-icon-placeholder"><%= s.team.icon_path %></span><% } else { %><span class="team-icon-placeholder"><%= s.team.name.charAt(0).toUpperCase() %></span><% } %>
```

- [ ] **Step 5: Commit**

```
git add views/admin/index.ejs views/index.ejs views/tv.ejs
git commit -m "feat: render emoji icons in all team icon locations"
```

---

## Task 4: Manual smoke test

- [ ] **Step 1: Start the server**

```
node server.js
```

Open `http://localhost:3000/admin` (PIN: `1234`).

- [ ] **Step 2: Test generate flow**

1. Go to `http://localhost:3000/admin/setup`
2. Click "🎲 Generate Random Teams" — all 12 name inputs should fill with animal/element names
3. Click "Save Teams"
4. Go to `http://localhost:3000/admin` — verify each team card shows its emoji in the icon circle instead of a letter
5. Verify standings table shows emoji icons once a schedule is generated

- [ ] **Step 3: Confirm existing upload still works**

1. On the admin dashboard, click "📷 Bild" next to any generated team and upload an image
2. Verify the image replaces the emoji (the uploaded path starts with `/` and takes the image branch)

- [ ] **Step 4: Confirm public pages show emoji**

Open `http://localhost:3000` and `http://localhost:3000/tv` — verify emoji icons appear in standings after generating a schedule.
