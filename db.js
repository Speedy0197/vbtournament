const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'tournament.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    group_name TEXT NOT NULL CHECK(group_name IN ('A', 'B')),
    icon_path TEXT
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

// Migration: add icon_path column for existing databases
try { db.exec('ALTER TABLE teams ADD COLUMN icon_path TEXT'); } catch (e) {}

const getSetsForMatchStmt = db.prepare(
  'SELECT * FROM sets WHERE match_id = ? ORDER BY set_number'
);

const getTeams = () =>
  db.prepare('SELECT * FROM teams ORDER BY group_name, name').all();

const insertTeam = (name, group, iconPath = null) =>
  db.prepare('INSERT OR IGNORE INTO teams (name, group_name, icon_path) VALUES (?, ?, ?)').run(name, group, iconPath);

const clearAll = db.transaction(() => {
  db.prepare('DELETE FROM sets').run();
  db.prepare('DELETE FROM matches').run();
  db.prepare('DELETE FROM teams').run();
});

const getFullState = () => {
  const teams = db.prepare('SELECT * FROM teams ORDER BY group_name, id').all();
  const matches = db.prepare(`
    SELECT m.*, t1.name AS team1_name, t1.icon_path AS team1_icon,
                t2.name AS team2_name, t2.icon_path AS team2_icon
    FROM matches m
    LEFT JOIN teams t1 ON m.team1_id = t1.id
    LEFT JOIN teams t2 ON m.team2_id = t2.id
    ORDER BY m.id
  `).all();
  for (const match of matches) {
    match.sets = getSetsForMatchStmt.all(match.id);
  }
  return { teams, matches };
};

const getMatchWithSets = (id) => {
  const match = db.prepare(`
    SELECT m.*, t1.name AS team1_name, t1.icon_path AS team1_icon,
                t2.name AS team2_name, t2.icon_path AS team2_icon
    FROM matches m
    LEFT JOIN teams t1 ON m.team1_id = t1.id
    LEFT JOIN teams t2 ON m.team2_id = t2.id
    WHERE m.id = ?
  `).get(id);
  if (!match) return null;
  match.sets = getSetsForMatchStmt.all(id);
  return match;
};

const insertMatch = (phase, court, team1Id, team2Id, label) =>
  db.prepare(
    'INSERT INTO matches (phase, court, team1_id, team2_id, label) VALUES (?, ?, ?, ?, ?)'
  ).run(phase, court, team1Id, team2Id, label);

const updateMatchStatus = (id, status) =>
  db.prepare('UPDATE matches SET status = ? WHERE id = ?').run(status, id);

const clearMatches = db.transaction(() => {
  db.prepare('DELETE FROM sets').run();
  db.prepare('DELETE FROM matches').run();
});

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

const updateTeamIcon = (id, iconPath) =>
  db.prepare('UPDATE teams SET icon_path = ? WHERE id = ?').run(iconPath, id);

const updateTeamGroup = (id, group) =>
  db.prepare('UPDATE teams SET group_name = ? WHERE id = ?').run(group, id);

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
  updateTeamIcon,
  updateTeamGroup,
};
