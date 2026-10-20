const Database = require('better-sqlite3');
const path = require('path');
const {correctionSnapshot,matchSnapshot}=require('./score-corrections');
const sameState=(a,b)=>JSON.stringify(correctionSnapshot(a))===JSON.stringify(correctionSnapshot(b));

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'tournament.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

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
    set_target INTEGER NOT NULL DEFAULT 25,
    deciding_set_target INTEGER NOT NULL DEFAULT 15,
    estimated_minutes INTEGER NOT NULL DEFAULT 40,
    scoring_format TEXT NOT NULL DEFAULT 'sets' CHECK(scoring_format IN ('sets', 'timed')),
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

// Existing matches retain the original 25/25/15 targets on migration.
const matchColumns = new Set(db.prepare('PRAGMA table_info(matches)').all().map(column => column.name));
for (const [column, value] of [['set_target', 25], ['deciding_set_target', 15], ['estimated_minutes', 40]]) {
  if (!matchColumns.has(column)) db.exec('ALTER TABLE matches ADD COLUMN ' + column + ' INTEGER NOT NULL DEFAULT ' + value);
}

if (!matchColumns.has('scoring_format')) db.exec("ALTER TABLE matches ADD COLUMN scoring_format TEXT NOT NULL DEFAULT 'sets' CHECK(scoring_format IN ('sets', 'timed'))");

if (!matchColumns.has('timed_periods')) {
  const sql = require('node:fs').readFileSync(path.join(__dirname, 'migrations/0003_seven_team_finals.sql'), 'utf8');
  db.transaction(() => db.exec(sql))();
}

if (!matchColumns.has('fixed_sets')) {
  const sql = require('node:fs').readFileSync(path.join(__dirname, 'migrations/0004_final_tournament_format.sql'), 'utf8');
  db.transaction(() => db.exec(sql))();
}

if (!matchColumns.has('referee_team_id')) {
  const sql = require('node:fs').readFileSync(path.join(__dirname, 'migrations/0005_referee_teams.sql'), 'utf8');
  db.transaction(() => db.exec(sql))();
}

if (!matchColumns.has('completed_at')) {
  const sql = require('node:fs').readFileSync(path.join(__dirname, 'migrations/0006_adaptive_timing.sql'), 'utf8');
  db.transaction(() => db.exec(sql))();
}

const getScoringRules = () => ({ ...require('./tournament').TOURNAMENT_RULES });

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
  db.prepare("DELETE FROM settings WHERE key IN ('tournament_mode', 'scoring_rules')").run();
});

const getFullState = () => {
  const teams = db.prepare('SELECT * FROM teams ORDER BY group_name, id').all();
  const matches = db.prepare(`
    SELECT m.*, t1.name AS team1_name, t1.icon_path AS team1_icon,
                t2.name AS team2_name, t2.icon_path AS team2_icon, r.name AS referee_name, r.icon_path AS referee_icon
    FROM matches m
    LEFT JOIN teams t1 ON m.team1_id = t1.id
    LEFT JOIN teams t2 ON m.team2_id = t2.id
    LEFT JOIN teams r ON m.referee_team_id = r.id
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
                t2.name AS team2_name, t2.icon_path AS team2_icon, r.name AS referee_name, r.icon_path AS referee_icon
    FROM matches m
    LEFT JOIN teams t1 ON m.team1_id = t1.id
    LEFT JOIN teams t2 ON m.team2_id = t2.id
    LEFT JOIN teams r ON m.referee_team_id = r.id
    WHERE m.id = ?
  `).get(id);
  if (!match) return null;
  match.sets = getSetsForMatchStmt.all(id);
  return match;
};

const insertMatch = (phase, court, team1Id, team2Id, label, options = {}) => {
  const rules = getScoringRules();
  return db.prepare(
    'INSERT INTO matches (phase, court, team1_id, team2_id, label, set_target, deciding_set_target, estimated_minutes, scoring_format, timed_periods, sets_to_win, fixed_sets, referee_team_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(phase, court, team1Id, team2Id, label, rules.setTarget, rules.decidingSetTarget, options.estimated_minutes ?? rules.matchMinutes, options.scoring_format || 'sets', options.timed_periods ?? 1, options.sets_to_win ?? 2, options.fixed_sets ?? 0, options.referee_team_id ?? null);
};

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

const getTournamentMode = () =>
  db.prepare("SELECT value FROM settings WHERE key = 'tournament_mode'").get()?.value;

const setTournamentMode = mode =>
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tournament_mode', ?)").run(mode);

// Called only after the route validates the mode/count and confirms any reset.
const saveSchedule = db.transaction((mode, teams, matches) => {
  clearMatches();
  for (const team of teams) updateTeamGroup(team.id, team.group_name);
  for (const match of matches) {
    insertMatch('group', match.court, match.team1_id, match.team2_id, match.label || null, match);
  }
  setTournamentMode(mode);
});

const regenerateSchedule = db.transaction((teams, matches) => {
  const current = getTeams();
  if (current.length !== teams.length || current.some(team => !teams.some(input => input.id === team.id))
    || db.prepare("SELECT 1 FROM matches WHERE status <> 'pending'").get()
    || db.prepare('SELECT 1 FROM sets').get()) return false;
  saveSchedule('league', teams, matches);
  return true;
});

// Check eligibility inside the same transaction as rebuilding the schedule.
const withdrawTeam = db.transaction((teamId, remaining, matches) => {
  if (db.prepare('SELECT count(*) AS n FROM teams').get().n !== 7
    || !db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId)
    || db.prepare("SELECT 1 FROM matches WHERE status <> 'pending'").get()
    || db.prepare('SELECT 1 FROM sets').get()) return false;
  clearMatches();
  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  saveSchedule('league', remaining, matches);
  return true;
});

const saveTeamSetup = db.transaction((expected, desired, namedMatches) => {
  const current=getFullState();
  const snapshot=teams=>JSON.stringify([...teams].sort((a,b)=>a.id-b.id).map(t=>[t.id,t.name]));
  if (snapshot(current.teams)!==snapshot(expected) || current.matches.some(m=>m.status!=='pending'||m.sets.length)) return false;
  clearMatches();
  const kept=new Set(desired.filter(t=>t.id>0).map(t=>t.id));
  for(const old of current.teams) if(!kept.has(old.id)) db.prepare('DELETE FROM teams WHERE id=?').run(old.id);
  const token=require('node:crypto').randomUUID();
  for(const t of desired.filter(t=>t.id>0)) db.prepare('UPDATE teams SET name=? WHERE id=?').run('__setup_'+token+'_'+t.id,t.id);
  for(const t of desired){
    if(t.id>0) db.prepare('UPDATE teams SET name=?,group_name=\'A\' WHERE id=?').run(t.name,t.id);
    else db.prepare('INSERT INTO teams(name,group_name)VALUES(?,\'A\')').run(t.name);
  }
  const teams=getTeams(),byName=new Map(teams.map(t=>[t.name,t.id]));
  const schedule=namedMatches.map(m=>({...m,team1_id:byName.get(m.team1_name)??-1,team2_id:byName.get(m.team2_name)??-1,referee_team_id:byName.get(m.referee_name)??-1}));
  saveSchedule('league',teams,schedule);
  return true;
});

const replaceTeams = db.transaction((teams, mode = null) => {
  clearAll();
  for (const team of teams) insertTeam(team.name, 'A', team.emoji || null);
  if (mode) setTournamentMode(mode);
});
const saveScore = db.transaction((id, sets, status, expectedMatch = null) => {
  const actual=getMatchWithSets(id);
  if(expectedMatch&&matchSnapshot(actual)!==matchSnapshot(expectedMatch))return false;
  if(expectedMatch){
    const participants=[actual.team1_id,actual.team2_id,actual.referee_team_id].filter(id=>id!=null);
    if(getFullState().matches.some(m=>m.id!==id&&m.status==='active'&&(m.court===actual.court||[m.team1_id,m.team2_id,m.referee_team_id].some(team=>participants.includes(team)))))return false;
  }
  if (!db.prepare('SELECT id FROM matches WHERE id=?').get(id)) return false;
  // Freeze final standings in the same transaction as the score write.
  const locked = db.prepare(`SELECT 1 FROM matches target WHERE target.id = ? AND (
      (target.phase = 'group' AND target.scoring_format = 'timed'
        AND (EXISTS (SELECT 1 FROM matches WHERE phase <> 'group')
          OR (target.status = 'done' AND NOT EXISTS (SELECT 1 FROM matches WHERE phase = 'group' AND status <> 'done'))))
      OR (target.phase = 'gold_sf'
        AND (EXISTS (SELECT 1 FROM matches WHERE phase = 'gold_final')
          OR (target.status = 'done' AND NOT EXISTS (SELECT 1 FROM matches WHERE phase = 'gold_sf' AND status <> 'done'))))
    )`).get(id);
  if (locked) return false;
  deleteSetsForMatch(id);
  for (const set of sets) upsertSet(id, set.n, set.t1, set.t2);
  db.prepare("UPDATE matches SET status=?, completed_at=CASE WHEN ?='done' THEN coalesce(completed_at,?) ELSE completed_at END WHERE id=?")
    .run(status,status,new Date().toISOString(),id);
  return true;
});

const correctScore = db.transaction((id, scores, expectedMatch = null) => {
  const state=getFullState();
  if(expectedMatch&&matchSnapshot(state.matches.find(m=>m.id===id))!==matchSnapshot(expectedMatch))return {ok:false,error:'This result changed while saving. Reload the score form.'};
  const plan=require('./score-corrections').planScoreCorrection(state,id,scores);
  if(!plan.ok)return plan;
  deleteSetsForMatch(id);
  for(const s of scores)upsertSet(id,s.n,s.t1,s.t2);
  for(const m of plan.updates)db.prepare('UPDATE matches SET team1_id=?,team2_id=?,referee_team_id=? WHERE id=?').run(m.team1_id,m.team2_id,m.referee_team_id,m.id);
  return {ok:true};
});

const saveScores = db.transaction(scores => {
  // Test-fill requests may arrive with a stale list; preserve real results.
  for (const score of scores) {
    if (getMatchWithSets(score.id)?.status === 'pending') saveScore(score.id, score.sets, score.status);
  }
});

const insertBracketMatches = db.transaction((matches, expectedState = null) => {
  if(expectedState&&!sameState(getFullState(),expectedState))return false;
  for (const args of matches) {
    if (!db.prepare('SELECT id FROM matches WHERE phase = ? AND label = ?').get(args[0], args[4])) insertMatch(...args);
  }
  return true;
});

const updateMatchReferee = db.transaction((id, teamId, expectedState = null) => {
  if(expectedState&&!sameState(getFullState(),expectedState))return false;
  return db.prepare("UPDATE matches SET referee_team_id = ? WHERE id = ? AND status = 'pending' AND NOT EXISTS (SELECT 1 FROM sets WHERE sets.match_id = matches.id)").run(teamId,id).changes>0;
});

module.exports = {
  close: () => db.close(),
  saveTeamSetup, regenerateSchedule, withdrawTeam, insertBracketMatches,
  replaceTeams, saveScore, correctScore, saveScores,
  getScoringRules,
  getTournamentMode,
  setTournamentMode,
  saveSchedule,
  getTeams,
  insertTeam,
  clearAll,
  getFullState,
  getMatchWithSets,
  insertMatch,
  updateMatchStatus,
  updateMatchReferee,
  clearMatches,
  upsertSet,
  deleteSetsForMatch,
  updateTeamIcon,
  updateTeamGroup,
};
