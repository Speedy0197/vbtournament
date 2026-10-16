import { randomUUID } from 'node:crypto';
import corrections from '../score-corrections.js';
const MATCH_SELECT = `SELECT m.*, t1.name AS team1_name, t1.icon_path AS team1_icon,
  t2.name AS team2_name, t2.icon_path AS team2_icon, r.name AS referee_name, r.icon_path AS referee_icon FROM matches m
  LEFT JOIN teams t1 ON m.team1_id = t1.id LEFT JOIN teams t2 ON m.team2_id = t2.id LEFT JOIN teams r ON m.referee_team_id = r.id`;

export function createDatabase(database) {
  const stmt = (sql, ...args) => database.prepare(sql).bind(...args);
  const all = async (sql, ...args) => (await stmt(sql, ...args).all()).results;
  const deleteMatches = () => [stmt('DELETE FROM sets'), stmt('DELETE FROM matches')];
  const matchInsert = (phase, court, team1, team2, label, options = {}) => stmt(
    'INSERT OR IGNORE INTO matches (phase, court, team1_id, team2_id, label, set_target, deciding_set_target, estimated_minutes, scoring_format, timed_periods, sets_to_win, fixed_sets, referee_team_id) VALUES (?, ?, ?, ?, ?, 25, 15, ?, ?, ?, ?, ?, ?)',
    phase, court, team1, team2, label ?? null, options.estimated_minutes ?? 40, options.scoring_format || 'sets', options.timed_periods ?? 1, options.sets_to_win ?? 2, options.fixed_sets ?? 0, options.referee_team_id ?? null);
  const scheduleInsert = (matches, guard = '1', ...args) => stmt(
    "INSERT INTO matches (phase, court, team1_id, team2_id, label, set_target, deciding_set_target, estimated_minutes, scoring_format, timed_periods, sets_to_win, fixed_sets, referee_team_id)"
    + " SELECT 'group', json_extract(value, '$.court'), json_extract(value, '$.team1_id'), json_extract(value, '$.team2_id'), json_extract(value, '$.label'),"
    + " 25, 15, coalesce(json_extract(value, '$.estimated_minutes'), 40),"
    + " coalesce(json_extract(value, '$.scoring_format'), 'sets'), coalesce(json_extract(value, '$.timed_periods'), 1),"
    + " 2, 0, json_extract(value, '$.referee_team_id') FROM json_each(?) WHERE " + guard, JSON.stringify(matches), ...args);
  const setInsert = (match, number, a, b) => stmt(`INSERT INTO sets (match_id, set_number, team1_score, team2_score)
    VALUES (?, ?, ?, ?) ON CONFLICT(match_id, set_number) DO UPDATE SET
    team1_score = excluded.team1_score, team2_score = excluded.team2_score`, match, number, a, b);
  const withSnapshot=async(key,state,writes)=>{
    const snapshot=corrections.correctionSnapshot(state),token=randomUUID();
    const eligible="(SELECT json_group_array(id) FROM (SELECT id FROM teams ORDER BY id))=?"
      +" AND (SELECT json_group_array(json_array(id,phase,court,team1_id,team2_id,referee_team_id,status)) FROM (SELECT * FROM matches ORDER BY id))=?"
      +" AND (SELECT json_group_array(json_array(match_id,set_number,team1_score,team2_score)) FROM (SELECT * FROM sets ORDER BY match_id,set_number))=?";
    const guard='EXISTS(SELECT 1 FROM settings WHERE key=? AND value=?)';
    const result=await database.batch([
      stmt('INSERT OR REPLACE INTO settings(key,value) SELECT ?,? WHERE '+eligible,key,token,snapshot.teams,snapshot.matches,snapshot.sets),
      ...writes(guard,[key,token]),
      stmt('DELETE FROM settings WHERE key=? AND value=?',key,token),
    ]);
    return result.at(-1).meta.changes>0;
  };
  return {
    getScoringRules: async () => ({ setTarget: 25, decidingSetTarget: 15, matchMinutes: 40, playoffSetsToWin: 2 }),
    getTeams: () => all('SELECT * FROM teams ORDER BY group_name, name'),
    insertTeam: (name, group, icon = null) => stmt('INSERT OR IGNORE INTO teams (name, group_name, icon_path) VALUES (?, ?, ?)', name, group, icon).run(),
    clearAll: () => database.batch([...deleteMatches(), stmt('DELETE FROM teams'), stmt("DELETE FROM settings WHERE key IN ('tournament_mode', 'scoring_rules')")]),
    async replaceTeams(teams, mode = null) {
      const statements = [...deleteMatches(), stmt('DELETE FROM teams'), stmt("DELETE FROM settings WHERE key IN ('tournament_mode', 'scoring_rules')")];
      for (const team of teams) statements.push(stmt('INSERT OR IGNORE INTO teams (name, group_name, icon_path) VALUES (?, ?, ?)', team.name, 'A', team.emoji ?? null));
      if (mode) statements.push(stmt("INSERT OR REPLACE INTO settings (key, value) VALUES ('tournament_mode', ?)", mode));
      await database.batch(statements);
    },
    async getFullState() {
      const result = await database.batch([
        stmt('SELECT * FROM teams ORDER BY group_name, id'), stmt(MATCH_SELECT + ' ORDER BY m.id'),
        stmt('SELECT * FROM sets ORDER BY match_id, set_number'),
      ]);
      const [teams, matches, sets] = result.map(r => r.results);
      const byMatch = new Map();
      for (const set of sets) {
        if (!byMatch.has(set.match_id)) byMatch.set(set.match_id, []);
        byMatch.get(set.match_id).push(set);
      }
      for (const match of matches) match.sets = byMatch.get(match.id) || [];
      return { teams, matches };
    },
    async getMatchWithSets(id) {
      const match = await stmt(MATCH_SELECT + ' WHERE m.id = ?', id).first();
      if (match) match.sets = await all('SELECT * FROM sets WHERE match_id = ? ORDER BY set_number', id);
      return match;
    },
    async insertBracketMatches(matches,expectedState=null){
      if(!expectedState)return database.batch(matches.map(args=>matchInsert(...args)));
      return withSnapshot('bracket_guard',expectedState,(guard,args)=>matches.map(([phase,court,a,b,label,options={}])=>stmt(
        'INSERT OR IGNORE INTO matches(phase,court,team1_id,team2_id,label,set_target,deciding_set_target,estimated_minutes,scoring_format,timed_periods,sets_to_win,fixed_sets,referee_team_id) SELECT ?,?,?,?,?,25,15,40,\'sets\',1,2,0,? WHERE '+guard,
        phase,court,a,b,label,options.referee_team_id??null,...args)));
    },
    insertMatch: (...args) => matchInsert(...args).run(),
    async updateMatchReferee(id,teamId,expectedState=null){
      if(expectedState)return withSnapshot('referee_guard',expectedState,(guard,args)=>[stmt("UPDATE matches SET referee_team_id=? WHERE id=? AND status='pending' AND NOT EXISTS(SELECT 1 FROM sets WHERE match_id=matches.id) AND "+guard,teamId,id,...args)]);
      return stmt("UPDATE matches SET referee_team_id = ? WHERE id = ? AND status = 'pending' AND NOT EXISTS (SELECT 1 FROM sets WHERE sets.match_id = matches.id)",teamId,id).run();
    },
    updateMatchStatus: (id, status) => stmt('UPDATE matches SET status = ? WHERE id = ?', status, id).run(),
    clearMatches: () => database.batch(deleteMatches()),
    upsertSet: (...args) => setInsert(...args).run(),
    deleteSetsForMatch: id => stmt('DELETE FROM sets WHERE match_id = ?', id).run(),
    updateTeamIcon: (id, icon) => stmt('UPDATE teams SET icon_path = ? WHERE id = ?', icon, id).run(),
    updateTeamGroup: (id, group) => stmt('UPDATE teams SET group_name = ? WHERE id = ?', group, id).run(),
    getTournamentMode: async () => (await stmt("SELECT value FROM settings WHERE key = 'tournament_mode'").first())?.value,
    setTournamentMode: mode => stmt("INSERT OR REPLACE INTO settings (key, value) VALUES ('tournament_mode', ?)", mode).run(),
    async saveSchedule(mode, teams, matches) {
      await database.batch([
        ...deleteMatches(),
        stmt(`UPDATE teams SET group_name = json_extract(value, '$.group_name')
          FROM json_each(?) WHERE teams.id = json_extract(value, '$.id')`, JSON.stringify(teams)),
        scheduleInsert(matches),
        stmt("INSERT OR REPLACE INTO settings (key, value) VALUES ('tournament_mode', ?)", mode),
      ]);
    },
    async regenerateSchedule(teams, matches) {
      const eligible = "(SELECT count(*) FROM teams) = ?"
        + " AND NOT EXISTS (SELECT 1 FROM teams WHERE id NOT IN (SELECT value FROM json_each(?)))"
        + " AND NOT EXISTS (SELECT 1 FROM sets)"
        + " AND NOT EXISTS (SELECT 1 FROM matches WHERE status <> 'pending')";
      const args = [teams.length, JSON.stringify(teams.map(team => team.id))];
      const result = await database.batch([
        stmt('DELETE FROM matches WHERE ' + eligible, ...args),
        stmt("UPDATE teams SET group_name = 'A' WHERE " + eligible, ...args),
        scheduleInsert(matches, eligible, ...args),
        stmt("INSERT OR REPLACE INTO settings (key, value) SELECT 'tournament_mode', 'league' WHERE " + eligible, ...args),
      ]);
      return result.at(-1).meta.changes > 0;
    },

    async withdrawTeam(teamId, remaining, matches) {
      // Delete the team last so each statement shares the same eligibility guard.
      const eligible = "(SELECT count(*) FROM teams) = 7"
        + " AND EXISTS (SELECT 1 FROM teams WHERE id = ?)"
        + " AND NOT EXISTS (SELECT 1 FROM sets)"
        + " AND NOT EXISTS (SELECT 1 FROM matches WHERE status <> 'pending')";
      const result = await database.batch([
        stmt('DELETE FROM matches WHERE ' + eligible, teamId),
        scheduleInsert(matches, eligible, teamId),
        stmt('DELETE FROM teams WHERE id = ? AND ' + eligible, teamId, teamId),
      ]);
      return result.at(-1).meta.changes > 0;
    },
    async saveTeamSetup(expected, desired, namedMatches) {
      const token=randomUUID(), guard="EXISTS(SELECT 1 FROM settings WHERE key='setup_guard' AND value=?)";
      const eligible="(SELECT count(*) FROM teams)=? AND NOT EXISTS(SELECT 1 FROM teams t WHERE NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE json_extract(e.value,'$.id')=t.id AND json_extract(e.value,'$.name')=t.name))"
        + " AND NOT EXISTS(SELECT 1 FROM sets) AND NOT EXISTS(SELECT 1 FROM matches WHERE status<>'pending')";
      const rows=JSON.stringify(desired),keep=JSON.stringify(desired.filter(t=>t.id>0).map(t=>t.id));
      const result=await database.batch([
        stmt("INSERT OR REPLACE INTO settings(key,value) SELECT 'setup_guard',? WHERE "+eligible,token,expected.length,JSON.stringify(expected.map(({id,name})=>({id,name})))),
        stmt('DELETE FROM matches WHERE '+guard,token),
        stmt('DELETE FROM teams WHERE id NOT IN(SELECT value FROM json_each(?)) AND '+guard,keep,token),
        stmt("UPDATE teams SET name='__setup_'||?||'_'||id WHERE "+guard,token,token),
        stmt("UPDATE teams SET name=json_extract(e.value,'$.name'),group_name='A' FROM json_each(?) e WHERE teams.id=json_extract(e.value,'$.id') AND "+guard,rows,token),
        stmt("INSERT INTO teams(name,group_name) SELECT json_extract(e.value,'$.name'),'A' FROM json_each(?) e WHERE json_extract(e.value,'$.id')<0 AND "+guard,rows,token),
        stmt("INSERT INTO matches(phase,court,team1_id,team2_id,label,set_target,deciding_set_target,estimated_minutes,scoring_format,timed_periods,sets_to_win,fixed_sets,referee_team_id)"
          + " SELECT 'group',json_extract(e.value,'$.court'),coalesce((SELECT id FROM teams WHERE name=json_extract(e.value,'$.team1_name')),-1),coalesce((SELECT id FROM teams WHERE name=json_extract(e.value,'$.team2_name')),-1),json_extract(e.value,'$.label'),25,15,20,'timed',2,2,0,coalesce((SELECT id FROM teams WHERE name=json_extract(e.value,'$.referee_name')),-1) FROM json_each(?) e WHERE "+guard,JSON.stringify(namedMatches),token),
        stmt("INSERT OR REPLACE INTO settings(key,value) SELECT 'tournament_mode','league' WHERE "+guard,token),
        stmt("DELETE FROM settings WHERE key='setup_guard' AND value=?",token),
      ]);
      return result.at(-1).meta.changes>0;
    },

    async correctScore(id,scores,expectedMatch=null) {
      const state=await this.getFullState();
      if(expectedMatch&&corrections.matchSnapshot(state.matches.find(m=>m.id===id))!==corrections.matchSnapshot(expectedMatch))return {ok:false,error:'This result changed while saving. Reload the score form.'};
      const plan=corrections.planScoreCorrection(state,id,scores);
      if(!plan.ok)return plan;
      const saved=await withSnapshot('score_correction_guard',state,(guard,args)=>[
        stmt('DELETE FROM sets WHERE match_id=? AND '+guard,id,...args),
        ...scores.map(s=>stmt('INSERT INTO sets(match_id,set_number,team1_score,team2_score) SELECT ?,?,?,? WHERE '+guard,id,s.n,s.t1,s.t2,...args)),
        ...plan.updates.map(m=>stmt('UPDATE matches SET team1_id=?,team2_id=?,referee_team_id=? WHERE id=? AND '+guard,m.team1_id,m.team2_id,m.referee_team_id,m.id,...args)),
      ]);
      return saved?{ok:true}:{ok:false,error:'The tournament changed while saving. Reload the score form and try again.'};
    },

    async saveScores(scores) {
      if (!scores.length) return;
      const ids = JSON.stringify(scores.map(score => score.id));
      const sets = JSON.stringify(scores.flatMap(score => score.sets.map(set => ({ ...set, id: score.id }))));
      await database.batch([
        stmt("DELETE FROM sets WHERE match_id IN (SELECT value FROM json_each(?)) AND match_id IN (SELECT id FROM matches WHERE status = 'pending')", ids),
        stmt(`INSERT INTO sets (match_id, set_number, team1_score, team2_score)
          SELECT json_extract(value, '$.id'), json_extract(value, '$.n'), json_extract(value, '$.t1'), json_extract(value, '$.t2')
          FROM json_each(?) WHERE json_extract(value, '$.id') IN (SELECT id FROM matches WHERE status = 'pending')`, sets),
        stmt(`UPDATE matches SET status = json_extract(value, '$.status')
          FROM json_each(?) WHERE matches.id = json_extract(value, '$.id') AND matches.status = 'pending'`, JSON.stringify(scores.map(({ id, status }) => ({ id, status })))),
      ]);
    },
    async saveScore(id, sets, status, expectedMatch=null) {
      if(expectedMatch){
        const state=await this.getFullState(),actual=state.matches.find(m=>m.id===id);
        if(corrections.matchSnapshot(actual)!==corrections.matchSnapshot(expectedMatch)||actual.status==='done'
          ||(actual.phase==='group'&&state.matches.some(m=>m.phase!=='group'))
          ||(actual.phase==='gold_sf'&&state.matches.some(m=>m.phase==='gold_final')))return false;
        return withSnapshot('score_guard',state,(guard,args)=>[
          stmt('DELETE FROM sets WHERE match_id=? AND '+guard,id,...args),
          ...sets.map(s=>stmt('INSERT INTO sets(match_id,set_number,team1_score,team2_score) SELECT ?,?,?,? WHERE '+guard,id,s.n,s.t1,s.t2,...args)),
          stmt('UPDATE matches SET status=? WHERE id=? AND '+guard,status,id,...args),
        ]);
      }
      // Every statement shares this guard inside one atomic D1 batch. Once the
      // last league result is done, no late edit may change the qualifying teams.
      const editable = `EXISTS (SELECT 1 FROM matches target WHERE target.id = ? AND NOT (
      (target.phase = 'group' AND target.scoring_format = 'timed'
        AND (EXISTS (SELECT 1 FROM matches WHERE phase <> 'group')
          OR (target.status = 'done' AND NOT EXISTS (SELECT 1 FROM matches WHERE phase = 'group' AND status <> 'done'))))
      OR (target.phase = 'gold_sf'
        AND (EXISTS (SELECT 1 FROM matches WHERE phase = 'gold_final')
          OR (target.status = 'done' AND NOT EXISTS (SELECT 1 FROM matches WHERE phase = 'gold_sf' AND status <> 'done'))))
    ))`;
      const result = await database.batch([
        stmt('DELETE FROM sets WHERE match_id = ? AND ' + editable, id, id),
        ...sets.map(set => stmt('INSERT INTO sets (match_id, set_number, team1_score, team2_score) SELECT ?, ?, ?, ? WHERE ' + editable,
          id, set.n, set.t1, set.t2, id)),
        stmt('UPDATE matches SET status = ? WHERE id = ? AND ' + editable, status, id, id),
      ]);
      return result[result.length - 1].meta.changes > 0;
    },
  };
}
