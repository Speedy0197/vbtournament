const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { calculateStandings, getMatchWinner, getTournamentFormat } = require('./tournament');

test('two timed sets split a match even when total rally points differ', () => {
  const teams = [1,2].map(id => ({id, name: 'Team ' + id}));
  const match = { team1_id: 1, team2_id: 2, status: 'done', scoring_format: 'timed', timed_periods: 2,
    sets: [{team1_score:20,team2_score:5},{team1_score:10,team2_score:11}] };
  const rows = calculateStandings(teams, [match], 'league');
  assert.deepEqual(rows.map(r => [r.wins,r.draws,r.losses,r.leaguePoints]), [[0,1,0,1],[0,1,0,1]]);
  match.sets[1] = {team1_score:11,team2_score:10};
  assert.equal(calculateStandings(teams,[match],'league')[0].wins,1);
  match.sets[1] = {team1_score:10,team2_score:10};
  assert.equal(calculateStandings(teams,[match],'league')[0].leaguePoints,0);
});

test('fixed playoffs need two set wins, targets 25/25/15 and a two-point margin',()=>{
  const rules={set_target:25,deciding_set_target:15,sets_to_win:2};
  assert.equal(getMatchWinner([{team1_score:25,team2_score:20}],rules),null);
  assert.equal(getMatchWinner([{team1_score:25,team2_score:20},{team1_score:25,team2_score:24}],rules),null);
  assert.equal(getMatchWinner([{team1_score:25,team2_score:20},{team1_score:26,team2_score:24}],rules),1);
  assert.equal(getMatchWinner([{team1_score:25,team2_score:20},{team1_score:20,team2_score:25},{team1_score:15,team2_score:14}],rules),null);
  assert.equal(getMatchWinner([{team1_score:25,team2_score:20},{team1_score:20,team2_score:25},{team1_score:16,team2_score:14}],rules),1);
});

test('seven-team event runs two timed sets, sequential semifinals and an independent placement round robin', async t => {
  process.env.DB_PATH = ':memory:';
  const db = require('./db');
  const createApp = require('./app');
  const app = createApp({db,icons:{clear:async()=>{}},adminPin:'x'});
  const server = app.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (route,fields) => fetch(base+route,{method:fields?'POST':'GET',redirect:'manual',
    headers:{Cookie:'admin=x',...(fields?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
    ...(fields?{body:new URLSearchParams(fields)}:{})});
  const state = async()=> (await request('/api/state')).json();
  db.replaceTeams(Array.from({length:7},(_,i)=>({name:'Team '+(i+1)})), 'league');
  assert.equal((await state()).rules.playoffSetsToWin,2);
  assert.match(await (await request('/admin')).text(), /Match desk/);
  assert.equal((await request('/admin/generate-schedule',{mode:'league'})).status,302);
  let current=await state();
  assert.equal(current.matches.length,21);
  assert.ok(current.matches.every(m=>m.timed_periods===2 && m.estimated_minutes===20));
  assert.ok(current.matches.every(m=>m.referee_team_id && m.referee_name));
  const first=current.matches[0];
  const scoreRoute='/admin/match/'+first.id+'/score';
  const leagueForm=await (await request(scoreRoute)).text();
  assert.match(leagueForm, /name="s2t1"/);
  assert.ok(leagueForm.includes(first.referee_name));
  db.updateMatchStatus(first.id,'active');
  const blockedByReferee=current.matches.find(m=>m.court!==first.court && [m.team1_id,m.team2_id].includes(first.referee_team_id));
  assert.equal((await request('/admin/match/'+blockedByReferee.id+'/score',{s1t1:'20',s1t2:'18',s2t1:'20',s2t2:'18'})).status,409);
  assert.equal((await request(scoreRoute,{s1t1:'12',s1t2:'10'})).status,400);
  assert.equal((await state()).matches[0].status,'active');
  for(const invalid of [
    {s1t1:'12',s1t2:'10'},
    {s1t1:'12',s1t2:'10',s2t1:'10',s2t2:'10'},
    {s1t1:'12',s1t2:'10',s2t1:'11x',s2t2:'10'},
    {s1t1:'12',s1t2:'10',s2t1:'11',s2t2:'10',s3t1:'1',s3t2:'0'}
  ]) assert.equal((await request(scoreRoute,{...invalid,finish:'yes'})).status,400);
  assert.equal((await request(scoreRoute,{s1t1:'20',s1t2:'5',s2t1:'10',s2t2:'11',finish:'yes'})).status,302);
  assert.equal((await state()).standings.A.find(r=>r.team.id===first.team1_id).draws,1);
  for(const m of (await state()).matches.filter(m=>m.phase==='group'&&m.status!=='done')) await request('/admin/match/'+m.id+'/score',{s1t1:'20',s1t2:'18',s2t1:'20',s2t2:'18',finish:'yes'});
  current=await state();
  const ranking=current.standings.A.map(r=>r.team.id);
  const semis=current.matches.filter(m=>m.phase==='gold_sf');
  const placement=current.matches.filter(m=>m.phase==='placement');
  assert.deepEqual(semis.map(m=>m.court),[1,1]);
  assert.equal(semis[0].referee_team_id,ranking[1]);
  assert.equal(semis[1].referee_team_id,null);
  assert.ok(semis.every(m=>m.sets_to_win===2));
  assert.deepEqual(semis.map(m=>[m.team1_id,m.team2_id]),[[ranking[0],ranking[3]],[ranking[1],ranking[2]]]);
  assert.equal(placement.length,3);
  assert.ok(placement.every(m=>m.court===2 && m.scoring_format==='sets' && m.fixed_sets===0 && m.sets_to_win===2));
  assert.ok(placement.every(m=>ranking.slice(4).includes(m.referee_team_id) && ![m.team1_id,m.team2_id].includes(m.referee_team_id)));
  const pairs=new Set(placement.map(m=>[m.team1_id,m.team2_id].sort().join('-')));
  assert.equal(pairs.size,3);
  assert.deepEqual([...new Set(placement.flatMap(m=>[m.team1_id,m.team2_id]))].sort(),ranking.slice(4).sort());
  assert.equal((await request('/admin/match/'+semis[1].id+'/score')).status,409);
  assert.equal((await request('/admin/match/'+semis[0].id+'/score',{s1t1:'15',s1t2:'14'})).status,400);
  assert.equal((await state()).matches.find(m=>m.id===semis[0].id).status,'pending');
  const placementRoute='/admin/match/'+placement[0].id+'/score';
  const placementForm=await (await request(placementRoute)).text();
  assert.match(placementForm,/name="s2t1"/);
  assert.match(placementForm,/name="s3t1"/);
  assert.equal((await request(placementRoute,{s1t1:'25',s1t2:'20'})).status,400);
  assert.equal((await state()).matches.find(m=>m.id===placement[0].id).status,'pending');
  assert.equal((await request(placementRoute,{s1t1:'25',s1t2:'20',s2t1:'20',s2t2:'25'})).status,400);
  assert.equal((await state()).matches.find(m=>m.id===placement[0].id).status,'pending');
  assert.equal((await request(placementRoute,{s1t1:'25',s1t2:'20',s2t1:'20',s2t2:'25',s3t1:'15',s3t2:'13'})).status,302);
  assert.equal((await state()).matches.find(m=>m.id===placement[0].id).status,'done');
  for (const m of placement.slice(1)) {
    assert.equal((await request('/admin/match/'+m.id+'/score',{s1t1:'25',s1t2:'20',s2t1:'25',s2t2:'20'})).status,302);
  }
  assert.equal((await request('/admin/match/'+semis[0].id+'/score',{s1t1:'26',s1t2:'24',s2t1:'25',s2t2:'20'})).status,302);
  assert.equal((await state()).matches.find(m=>m.id===semis[1].id).referee_team_id,semis[0].team2_id);
  await request('/admin/match/'+semis[0].id+'/score',{s1t1:'24',s1t2:'26',s2t1:'20',s2t2:'25'});
  assert.equal((await state()).matches.find(m=>m.id===semis[1].id).referee_team_id,semis[0].team1_id);
  await request('/admin/match/'+semis[0].id+'/score',{s1t1:'26',s1t2:'24',s2t1:'25',s2t2:'20'});
  assert.equal((await request('/admin/match/'+semis[1].id+'/score',{s1t1:'25',s1t2:'20',s2t1:'20',s2t2:'25',s3t1:'16',s3t2:'14'})).status,302);
  current=await state();
  const final=current.matches.find(m=>m.phase==='gold_final');
  assert.equal(final.court,1);
  assert.equal(current.matches.find(m=>m.id===semis[1].id).referee_team_id,semis[0].team2_id);
  assert.equal(final.referee_team_id,semis[1].team2_id);
  assert.deepEqual([final.team1_id,final.team2_id],semis.map(m=>m.team1_id));
  assert.equal(current.matches.length,27);
  assert.equal(current.placementStandings.reduce((n,r)=>n+r.wins,0),3);
  current=await state();
  assert.equal(current.matches.find(m=>m.id===final.id).set_target,25);
  assert.equal(current.matches.find(m=>m.id===semis[0].id).set_target,25);
  await request('/admin/match/'+final.id+'/score',{s1t1:'25',s1t2:'19',s2t1:'18',s2t2:'25',s3t1:'15',s3t2:'13'});
  assert.equal((await state()).matches.find(m=>m.id===final.id).status,'done');
  await request('/admin/advance-bracket',{});
  assert.equal((await state()).matches.length,27);
  for (const route of ['/','/admin','/admin/print']) {
    const response=await request(route);
    assert.equal(response.status,200);
    assert.match(await response.text(),/Placement/);
  }
  db.replaceTeams(Array.from({length:6},(_,i)=>({name:'Remaining '+i})), 'league');
  await request('/admin/generate-schedule',{mode:'league'});
  for(const m of (await state()).matches.filter(m=>m.phase==='group'&&m.status!=='done')) await request('/admin/match/'+m.id+'/score',{s1t1:'20',s1t2:'18',s2t1:'20',s2t2:'18',finish:'yes'});
  current=await state();
  assert.equal(current.matches.filter(m=>m.phase==='group').length,15);
  assert.equal(current.matches.filter(m=>m.phase==='placement').length,1);
  assert.equal(current.matches.filter(m=>m.phase==='gold_sf').length,2);
});

test('migration upgrades untouched timed schedules without resetting their teams or matches', async () => {
  const Database=require('better-sqlite3');
  const fs=require('node:fs');
  const database=new Database(':memory:');
  database.exec(fs.readFileSync('migrations/0001_initial.sql','utf8'));
  database.exec(fs.readFileSync('migrations/0002_timed_league.sql','utf8'));
  database.exec("INSERT INTO settings VALUES ('tournament_mode','league'); INSERT INTO teams (id,name,group_name) VALUES (1,'A','A'),(2,'B','A'); INSERT INTO matches (id,phase,court,team1_id,team2_id,scoring_format,label) VALUES (44,'group',1,1,2,'timed','Slot 1 · 10:00–10:20');");
  database.exec(fs.readFileSync('migrations/0003_seven_team_finals.sql','utf8'));
  const match=database.prepare('SELECT * FROM matches').get();
  assert.equal(match.id,44);
  assert.equal(match.team1_id,1);
  assert.equal(match.team2_id,2);
  assert.equal(match.timed_periods,2);
  assert.match(match.label,/10:00–10:25/);
  assert.equal(database.prepare('SELECT count(*) AS n FROM teams').get().n,2);
  database.close();
});

test('legacy fixed-two-set records remain readable with their original draw result',()=>{
  const teams=[{id:1,name:'One'},{id:2,name:'Two'}];
  const match={team1_id:1,team2_id:2,status:'done',scoring_format:'sets',fixed_sets:2,
    sets:[{team1_score:25,team2_score:5},{team1_score:20,team2_score:25}]};
  const rows=calculateStandings(teams,[match],'league');
  assert.deepEqual(rows.map(s=>[s.wins,s.draws,s.leaguePoints]),[[0,1,1],[0,1,1]]);
  match.sets=[{team1_score:25,team2_score:20}];
  assert.equal(calculateStandings(teams,[match],'league')[0].leaguePoints,0);
});

test('final-format migration changes only untouched league slots and preserves saved results',()=>{
  const Database=require('better-sqlite3');
  const fs=require('node:fs');
  for(const started of [false,true]){
    const database=new Database(':memory:');
    for(const name of ['0001_initial.sql','0002_timed_league.sql','0003_seven_team_finals.sql'])
      database.exec(fs.readFileSync('migrations/'+name,'utf8'));
    database.exec("INSERT INTO settings VALUES ('tournament_mode','league'); INSERT INTO teams (id,name,group_name) VALUES (1,'A','A'),(2,'B','A'); INSERT INTO matches (id,phase,court,team1_id,team2_id,scoring_format,timed_periods,estimated_minutes,label) VALUES (44,'group',1,1,2,'timed',2,25,'Slot 1 · 10:00–10:25');");
    if(started)database.exec("UPDATE matches SET status='active'; INSERT INTO sets (match_id,set_number,team1_score,team2_score) VALUES (44,1,12,10);");
    database.exec(fs.readFileSync('migrations/0004_final_tournament_format.sql','utf8'));
    const match=database.prepare('SELECT * FROM matches').get();
    assert.equal(match.id,44);
    assert.equal(match.fixed_sets,0);
    assert.equal(match.estimated_minutes,started?25:20);
    assert.match(match.label,started?/10:00–10:25/:/10:00–10:20/);
    assert.equal(database.prepare('SELECT count(*) AS n FROM sets').get().n,started?1:0);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
    database.close();
  }
});

test('league referee duties use idle teams, avoid double bookings and balance seven teams evenly',()=>{
  const {assignLeagueReferees,generateRoundRobinSchedule}=require('./tournament');
  for(const count of [6,7,8]){
    const ids=Array.from({length:count},(_,i)=>i+1);
    const games=assignLeagueReferees(generateRoundRobinSchedule(ids),ids);
    const counters={1:0,2:0},slots=new Map(),duties=new Map(ids.map(id=>[id,0]));
    for(const game of games){
      assert.ok(ids.includes(game.referee_team_id));
      duties.set(game.referee_team_id,duties.get(game.referee_team_id)+1);
      const slot=counters[game.court]++;
      if(!slots.has(slot))slots.set(slot,[]);
      slots.get(slot).push(game);
    }
    for(const games of slots.values()){
      const players=new Set(games.flatMap(m=>[m.team1_id,m.team2_id]));
      assert.ok(games.every(m=>!players.has(m.referee_team_id)));
      assert.equal(new Set(games.map(m=>m.referee_team_id)).size,games.length);
    }
    if(count===7)assert.deepEqual([...duties.values()],[3,3,3,3,3,3,3]);
    else assert.ok(Math.max(...duties.values())-Math.min(...duties.values())<=1);
  }
});

test('referee migration converts unstarted timed placements to two set wins and preserves scored games',()=>{
  const Database=require('better-sqlite3'),fs=require('node:fs');
  const database=new Database(':memory:');
  for(const file of ['0001_initial.sql','0002_timed_league.sql','0003_seven_team_finals.sql','0004_final_tournament_format.sql'])
    database.exec(fs.readFileSync('migrations/'+file,'utf8'));
  database.exec("INSERT INTO teams(id,name,group_name) VALUES(1,'A','A'),(2,'B','A'),(3,'Referee','A'); INSERT INTO settings(key,value) VALUES('scoring_rules','{\"setTarget\":21,\"decidingSetTarget\":15,\"matchMinutes\":35}'); INSERT INTO matches(id,phase,court,team1_id,team2_id,scoring_format,timed_periods,estimated_minutes,status) VALUES(1,'placement',2,1,2,'timed',2,25,'pending'),(2,'placement',2,1,2,'timed',2,25,'done'); INSERT INTO sets(match_id,set_number,team1_score,team2_score) VALUES(2,1,12,10),(2,2,10,12);");
  database.exec(fs.readFileSync('migrations/0005_referee_teams.sql','utf8'));
  const game=database.prepare('SELECT * FROM matches WHERE id=1').get();
  assert.equal(game.scoring_format,'sets');
  assert.equal(game.sets_to_win,2);
  assert.equal(game.fixed_sets,0);
  assert.equal(game.set_target,21);
  assert.equal(game.deciding_set_target,15);
  assert.equal(game.estimated_minutes,35);
  assert.equal(database.prepare('SELECT scoring_format FROM matches WHERE id=2').get().scoring_format,'timed');
  assert.equal(database.prepare('SELECT count(*) AS n FROM sets').get().n,2);
  assert.throws(()=>database.prepare('UPDATE matches SET referee_team_id=team1_id WHERE id=1').run());
  database.prepare('UPDATE matches SET referee_team_id=3 WHERE id=1').run();
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
  database.close();
});
