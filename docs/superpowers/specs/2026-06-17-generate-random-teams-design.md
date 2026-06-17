# Generate Random Teams with Emoji Icons

**Date:** 2026-06-17  
**Status:** Approved

## Summary

Add a "Generate Random Teams" button to the admin setup page (`/admin/setup`). Clicking it fills in 12 team names and assigns each team a random emoji, which is saved in the existing `icon_path` column (no schema change). All views that render team icons gain an emoji branch alongside the existing image and letter-placeholder branches.

## Data Layer

No schema changes. The existing `icon_path TEXT` column stores the emoji character directly (e.g. `🦁`). The rendering convention:

- `icon_path` starts with `/` → file upload → render as `<img>`
- `icon_path` is set and does not start with `/` → emoji → render as text in the placeholder span
- `icon_path` is null/empty → render first letter of team name

`db.insertTeam(name, group)` is extended to `insertTeam(name, group, iconPath)` with `iconPath` defaulting to `null`. The setup POST handler passes the emoji value when generating.

## Setup Page

A "🎲 Generate Random Teams" button is added to `views/admin/setup.ejs`, above the team input rows.

Each team row gains a hidden input: `<input type="hidden" name="emoji" value="">`.

A client-side JS block (inline in the view) holds a pool of 16 preset name+emoji pairs. On button click:
1. Shuffle the pool.
2. Take the first 12 entries.
3. Fill each name input and emoji hidden input.
4. Assign groups: rows 0–5 → A, rows 6–11 → B (matching the existing default).

The user can edit names before saving. The existing "Save Teams" form submit flow handles the rest.

## Server

`POST /admin/setup` reads `req.body.emoji` (parallel array to `req.body.name` and `req.body.group`). For each valid team, passes `emoji[i]` as the `iconPath` to `db.insertTeam`.

## Icon Rendering

Four locations are updated with a consistent three-branch pattern:

```ejs
<% if (t.icon_path && t.icon_path.startsWith('/')) { %>
  <img src="<%= t.icon_path %>" alt="<%= t.name %>" class="team-icon">
<% } else if (t.icon_path) { %>
  <span class="team-icon-placeholder"><%= t.icon_path %></span>
<% } else { %>
  <span class="team-icon-placeholder"><%= t.name.charAt(0).toUpperCase() %></span>
<% } %>
```

Locations:
- `views/admin/index.ejs` — team list (with `-lg` variant) and standings table
- `views/index.ejs` — standings table
- `views/tv.ejs` — standings table

## Preset Team Pool

16 entries, 12 selected at random per generation:

| Emoji | Name     |
|-------|----------|
| 🦁    | Lions    |
| 🐯    | Tigers   |
| 🦅    | Eagles   |
| 🐺    | Wolves   |
| 🦊    | Foxes    |
| 🐻    | Bears    |
| 🦈    | Sharks   |
| 🐬    | Dolphins |
| 🐍    | Cobras   |
| 🐆    | Leopards |
| 🦏    | Rhinos   |
| 🔥    | Flames   |
| ⚡    | Thunder  |
| 🌊    | Waves    |
| 🌪️   | Tornados |
| 🦋    | Falcons  |

## Out of Scope

- Emoji picker for manual team entry
- Changing a generated team's emoji after saving (use the existing image upload to override)
- Persisting emoji separately from `icon_path`
