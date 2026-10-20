import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createDatabase } from './cloudflare/database.mjs';
import tournament from './tournament.js';

test('Cloudflare keeps completed results and icons across restarts', async t => {
  await assert.doesNotReject(fs.access('dist/worker.mjs'), 'Build the Cloudflare Worker before running integration tests');
  const testRoot = path.resolve('.superpowers');
  await fs.mkdir(testRoot, { recursive: true });
  const storage = await fs.mkdtemp(path.join(testRoot, 'cloudflare-test-'));
  let mf;
  const start = async (pin = 'test-tournament-pin') => {
    mf = new Miniflare(convertV4MiniflareOptions({
      modules: true, scriptPath: 'dist/worker.mjs',
      compatibilityDate: '2026-09-18', compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'test-tournament' }, resourcePersistencePath: storage,
      bindings: pin ? { ADMIN_PIN: pin } : {},
    }));
    await mf.ready;
  };
  t.after(async () => {
    if (mf) await mf.dispose();
    assert.equal(path.dirname(storage), testRoot);
    await fs.rm(storage, { recursive: true, force: true });
  });
  await start();
  const database = await mf.getD1Database('DB');
  const migrationFiles = (await fs.readdir('migrations')).filter(name => name.endsWith('.sql')).sort();
  for (const file of migrationFiles) {
    const sql = await fs.readFile(path.join('migrations', file), 'utf8');
    if (file.startsWith('0003')) {
      await database.batch([
        database.prepare("INSERT INTO teams (id,name,group_name) VALUES (101,'Migration A','A'),(102,'Migration B','A')"),
        database.prepare("INSERT INTO matches (id,phase,court,team1_id,team2_id,status,scoring_format) VALUES (201,'group',1,101,102,'done','sets'),(202,'group',2,101,102,'done','timed')"),
        database.prepare("INSERT INTO sets (match_id,set_number,team1_score,team2_score) VALUES (201,1,25,20),(201,2,25,18),(202,1,20,20)")
      ]);
    }
    await database.batch(sql.split(';').filter(s => s.trim()).map(statement => database.prepare(statement)));
    if (file === migrationFiles.at(-1)) {
      await t.test('schema migration preserves existing scores, legacy formats and foreign keys', async () => {
        const migrated = await createDatabase(database).getFullState();
        assert.deepEqual(migrated.matches.map(m=>[m.id,m.timed_periods,m.sets_to_win,m.status]),[[201,1,2,'done'],[202,1,2,'done']]);
        assert.deepEqual(migrated.matches.map(m=>m.sets.map(s=>[s.team1_score,s.team2_score])),[[[25,20],[25,18]],[[20,20]]]);
        assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results,[]);
        await assert.rejects(database.prepare("INSERT INTO sets (match_id,set_number) VALUES (99999,1)").run());
      });
      await database.batch(['DELETE FROM sets','DELETE FROM matches','DELETE FROM teams',"DELETE FROM sqlite_sequence WHERE name IN ('teams','matches','sets')"].map(sql=>database.prepare(sql)));
    }
  }
  let cookie = '';
  const request = async (route, fields, authenticated = true) => {
    const url = 'http://localhost' + route;
    const headers = authenticated && cookie ? { Cookie: cookie } : {};
    let body = fields ? new URLSearchParams(fields) : undefined;
    if (fields instanceof FormData) {
      const encoded = new Request(url, { method: 'POST', body: fields });
      body = await encoded.arrayBuffer();
      headers['Content-Type'] = encoded.headers.get('content-type');
      headers['Content-Length'] = String(body.byteLength);
    }
    return mf.dispatchFetch(url, { method: fields ? 'POST' : 'GET', redirect: 'manual', headers, body });
  };
  const state = async () => (await request('/api/state')).json();
  const seedSeven = async () => {
    await createDatabase(await mf.getD1Database('DB')).replaceTeams(
      Array.from({length:7},(_,i)=>({name:'Team '+(i+1),emoji:i===0?'🏐':null})), 'league');
    assert.equal((await request('/admin/generate-schedule',{})).status,302);
  };

  await t.test('admin requires a login and accepts the configured secret', async () => {
    assert.equal((await request('/admin/setup', [['name', 'Unauthorized']], false)).status, 302);
    assert.equal((await state()).teams.length, 0);
    const login = await request('/admin/login', { pin: 'test-tournament-pin' }, false);
    assert.equal(login.status, 302);
    cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/admin')).status, 200);
  });
  await t.test('seven teams can create a fixed schedule and submit a completed match', async () => {
    await seedSeven();
    const before = await state();
    assert.equal(before.matches.length, 21);
    const match = before.matches[0];
    assert.equal((await request('/admin/match/' + match.id + '/score', {
      s1t1: '20', s1t2: '18', s2t1: '20', s2t2: '18', finish: 'yes',
    })).status, 302);
    const after = await state();
    assert.equal(after.matches[0].status, 'done');
    assert.equal(after.standings.A.find(s => s.team.id === match.team1_id).wins, 1);
    assert.equal((await request('/admin/generate-schedule', {})).status, 409);
    assert.deepEqual(await state(), after);
  });
  let iconUrl;
  // A valid tiny PNG; exercise real multipart parsing, storage, and serving.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await t.test('uploaded icons are stored separately from public assets', async () => {
    const body = new FormData();
    const teamId = (await state()).teams[0].id;
    body.set('icon', new Blob([png], { type: 'image/png' }), 'team.png');
    assert.equal((await request('/admin/team/' + teamId + '/icon', body)).status, 302);
    iconUrl = (await state()).teams.find(t => t.id === teamId).icon_path;
    assert.match(iconUrl || '', /^\/uploads\/teams\//);
    const image = await request(iconUrl);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  });
  await t.test('Worker restart preserves results and uploads', async () => {
    const before = await state();
    await mf.dispose();
    await start();
    assert.deepEqual(await state(), before);
    assert.ok(iconUrl, 'Upload must have returned a stored icon URL');
    assert.deepEqual(Buffer.from(await (await request(iconUrl)).arrayBuffer()), png);
  });
  await t.test('all existing screens render with compiled templates and fresh data', async () => {
    for (const route of ['/', '/qr', '/admin', '/admin/setup', '/admin/print', '/admin/match/1/score']) {
      const response = await request(route);
      assert.equal(response.status, 200, route + ': ' + await response.clone().text());
      assert.match(await response.text(), /<!DOCTYPE html>/i);
    }
    const html = await (await request('/')).text();
    assert.match(html, /Refresh scores/);
    assert.doesNotMatch(html, /Live Now/);
    assert.doesNotMatch(html, /http-equiv="refresh"/);
  });
  await t.test('failed database changes roll back completed scores and schedules', async () => {
    const adapter = createDatabase(await mf.getD1Database('DB'));
    const before = await state();
    await assert.rejects(adapter.saveScore(before.matches[0].id, [{ n: 4, t1: 25, t2: 0 }], 'done'));
    assert.deepEqual(await state(), before);
    await assert.rejects(adapter.saveSchedule('single', before.teams, [{ court: 1, team1_id: -1, team2_id: -2 }]));
    assert.deepEqual(await state(), before);
  });
  await t.test('maximum-size replacement icons work and invalid uploads preserve them', async () => {
    const teamId = (await state()).teams[0].id;
    const upload = async bytes => {
      const body = new FormData();
      body.set('icon', new Blob([bytes], { type: 'image/png' }), 'team.png');
      return request('/admin/team/' + teamId + '/icon', body);
    };
    const large = Buffer.alloc(5 * 1024 * 1024, 37);
    png.copy(large);
    assert.equal((await upload(large)).status, 302);
    const replacement = (await state()).teams[0].icon_path;
    assert.notEqual(replacement, iconUrl);
    // A cached old version may remain, but must never serve different bytes.
    const oldVersion = await request(iconUrl);
    assert.ok([200, 404].includes(oldVersion.status));
    if (oldVersion.ok) assert.deepEqual(Buffer.from(await oldVersion.arrayBuffer()), png);
    const image = await request(replacement);
    assert.match(image.headers.get('cache-control'), /immutable/);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), large);
    assert.equal((await upload(Buffer.concat([large, Buffer.from([0])]))).status, 400);
    assert.equal((await upload(Buffer.from('<svg>not a PNG</svg>'))).status, 400);
    assert.equal((await state()).teams[0].icon_path, replacement);
  });
  await t.test('hosted score entry is read-only and Save result accepts one completed set',async()=>{
    const before=await state(),match=before.matches.find(m=>m.status==='pending');
    const route='/admin/match/'+match.id+'/score';
    const response=await request(route);
    assert.equal(response.status,200);
    const html=await response.text();assert.match(html,/Save result/);
    assert.doesNotMatch(html,/Save progress|Finish game|Pause/);
    assert.deepEqual(await state(),before);
    assert.equal((await request(route,{s1t1:'20',s1t2:'18'})).status,302);
    assert.equal((await state()).matches.find(m=>m.id===match.id).status,'active');
    assert.equal((await state()).matches.find(m=>m.id===match.id).sets.length,1);
    assert.equal((await request(route,{s1t1:'20',s1t2:'18',s2t1:'18',s2t2:'20'})).status,302);
  });

  await t.test('hosted rules are fixed and pause controls preserve entered results', async () => {
    const before = await state();
    const upcoming = before.matches.find(match => match.status === 'pending');
    assert.equal((await request('/admin/match-rules', { setTarget: '21', decidingSetTarget: '11', matchMinutes: '30' })).status, 410);
    assert.deepEqual(await state(), before);
    assert.equal((await request('/admin/match/' + upcoming.id + '/score')).status, 200);
    assert.equal((await request('/admin/match/' + upcoming.id + '/pause', {})).status, 404);
    assert.equal((await state()).matches.find(match => match.id === upcoming.id).status, 'pending');
    for (const route of ['/admin/test', '/admin/test/seed', '/admin/test/fill']) {
      assert.equal((await request(route, route === '/admin/test' ? undefined : {})).status, 404);
    }
    assert.equal((await request('/admin/setup', { name: 'Wrong' })).status, 409);
    assert.equal((await request('/admin/generate-schedule', { mode: 'groups', confirmReset: 'yes' })).status, 400);
    await mf.dispose(); await start();
    assert.deepEqual((await state()).rules, before.rules);
    const html = await (await request('/admin')).text();
    assert.doesNotMatch(html, /name="mode"|name="setTarget"|name="playoffSetsToWin"/);
    assert.match(await (await request('/admin/setup')).text(), /Teams &amp; setup/);
  });

  await t.test('hosted timed league persists draws and advances into point-based playoffs', async () => {
    await seedSeven();

    let current = await state();
    assert.equal(current.matches.length, 21);
    assert.ok(current.matches.every(m => m.scoring_format === 'timed' && m.estimated_minutes === 20));
    assert.equal((await state()).rules.playoffSetsToWin,2);
    assert.match(await (await request('/admin')).text(), /Match desk/);
    assert.ok(current.matches.every(m=>m.referee_team_id && m.referee_name));
    assert.match(await (await request('/admin/print')).text(),/Referee team:/);
    const match = current.matches[0];
    const scoreRoute = '/admin/match/' + match.id + '/score';
    assert.equal((await request(scoreRoute, { s1t1: '20', s1t2: '19', s2t1: '19', s2t2: '20', finish: 'yes' })).status, 302);
    assert.equal((await request('/admin/match-rules', { setTarget: '15', decidingSetTarget: '15', matchMinutes: '40' })).status, 410);
    current = await state();
    assert.equal(current.matches[0].status, 'done');
    assert.equal(current.standings.A.find(s => s.team.id === match.team1_id).leaguePoints, 1);
    assert.ok(current.matches.every(m => m.estimated_minutes === 20));
    await mf.dispose(); await start();
    assert.deepEqual(await state(), current);
    for (const route of ['/', '/admin', '/admin/print', scoreRoute]) {
      const response = await request(route);
      assert.equal(response.status, 200, route + ': ' + await response.clone().text());
    }

    const adapter=createDatabase(await mf.getD1Database('DB'));
    await adapter.saveScores((await state()).matches.filter(m=>m.phase==='group'&&m.status==='pending').map(m=>({
      id:m.id,sets:[{n:1,t1:20,t2:18},{n:2,t1:20,t2:18}],status:'done'
    })));
    const database=await mf.getD1Database('DB');
    await database.prepare("CREATE TRIGGER fail_bracket BEFORE INSERT ON matches WHEN NEW.label = 'Semifinal 2' BEGIN SELECT RAISE(ABORT, 'test bracket failure'); END").run();
    assert.equal((await request('/admin/advance-bracket',{})).status,500);
    assert.equal((await state()).matches.filter(m=>m.phase!=='group').length,0);
    await database.prepare('DROP TRIGGER fail_bracket').run();
    assert.equal((await request('/admin/advance-bracket',{})).status,302);
    current = await state();
    const ids = current.standings.A.map(s => s.team.id);
    const semis = current.matches.filter(m => m.phase === 'gold_sf');
    assert.deepEqual(semis.map(m => [m.team1_id, m.team2_id]), [[ids[0], ids[3]], [ids[1], ids[2]]]);
    assert.ok(semis.every(m => m.scoring_format === 'sets' && m.set_target === 25 && m.court === 1 && m.sets_to_win === 2));
    assert.equal((await request('/admin/match/' + semis[1].id + '/score')).status,409);
    const beforeLocked = await state();
    assert.equal((await request('/admin/match/'+semis[0].id+'/score',{s1t1:'30',s1t2:'30',s2t1:'30',s2t2:'10'})).status,400);
    assert.deepEqual(await state(),beforeLocked);
    for (const semi of semis) {
      const route='/admin/match/' + semi.id + '/score';
      assert.equal((await request(route, { s1t1: '25', s1t2: '20', s2t1: '20', s2t2: '25', s3t1: '15', s3t2: '13' })).status, 302);
      if(semi.id===semis[0].id){
        assert.equal((await state()).matches.find(m=>m.id===semis[1].id).referee_team_id,semi.team2_id);
        await request(route,{s1t1:'20',s1t2:'25',s2t1:'25',s2t2:'20',s3t1:'13',s3t2:'15'});
        assert.equal((await state()).matches.find(m=>m.id===semis[1].id).referee_team_id,semi.team1_id);
        await request(route,{s1t1:'25',s1t2:'20',s2t1:'20',s2t2:'25',s3t1:'15',s3t2:'13'});
      }
    }
    current = await state();
    assert.equal(current.matches.length, 27);
    assert.equal(current.matches.filter(m => m.phase === 'gold_final').length, 1);
    assert.equal((await request('/admin/advance-bracket', {})).status, 302);
    assert.equal((await state()).matches.length, 27);
    const placement = current.matches.filter(m => m.phase === 'placement');
    assert.equal(placement.length, 3);
    assert.ok(placement.every(m => m.court === 2 && m.scoring_format === 'sets' && m.fixed_sets === 0 && m.sets_to_win === 2));
    for (const [index, game] of placement.entries()) {
      const route = '/admin/match/' + game.id + '/score';
      assert.equal((await request(route, {s1t1:'25',s1t2:'20'})).status,302);
      assert.equal((await state()).matches.find(m=>m.id===game.id).status,'active');
      assert.equal((await request(route, {s1t1:'25',s1t2:'20',s2t1:index===0?'20':'25',s2t2:index===0?'25':'20'})).status,302);
      assert.equal((await state()).matches.find(m=>m.id===game.id).status,index===0?'active':'done');
      if(index===0) assert.equal((await request(route, {s1t1:'25',s1t2:'20',s2t1:'20',s2t2:'25',s3t1:'15',s3t2:'13'})).status,302);
      assert.equal((await state()).matches.find(m=>m.id===game.id).status,'done');
    }
    const final = (await state()).matches.find(m => m.phase === 'gold_final');

    current = await state();
    assert.equal(current.matches.find(m=>m.id===final.id).sets_to_win, 2);
    assert.equal(current.matches.find(m=>m.id===final.id).set_target, 25);
    assert.ok(current.matches.filter(m=>m.phase==='gold_sf').every(m=>m.set_target===25 && m.sets_to_win===2));
    assert.equal((await request('/admin/match/' + final.id + '/score',{s1t1:'25',s1t2:'19',s2t1:'25',s2t2:'18'})).status,302);
    current = await state();
    assert.equal(current.matches.find(m=>m.id===final.id).status,'done');
    assert.equal(current.placementStandings.reduce((sum,row)=>sum+row.wins,0),3);
    for(const route of ['/','/admin','/admin/print']) {
      const response = await request(route);
      assert.equal(response.status,200);
      const html=await response.text();
      if(route==='/admin/print')assert.match(html,/Placement standings/);
      else{
        assert.match(html,/Tournament complete/);assert.match(html,/Final standings/);
        assert.equal((html.match(/data-final-rank=/g)||[]).length,7);
        assert.equal((html.match(/data-final-rank="3"/g)||[]).length,2);
        if(route==='/')assert.doesNotMatch(html,/League standings|Coming up/);
      }
    }
    await mf.dispose(); await start();
    assert.deepEqual(await state(), current);
  });


  await t.test('D1 refuses late timed-score writes before and after seeding', async () => {
    await seedSeven();

    const adapter = createDatabase(await mf.getD1Database('DB'));
    const games = (await state()).matches;
    const draw = [{ n: 1, t1: 20, t2: 19 }, { n: 2, t1: 19, t2: 20 }];
    assert.equal(await adapter.saveScore(games[0].id, draw, 'done'), true);
    assert.equal(await adapter.saveScore(games[0].id, [{ n: 1, t1: 21, t2: 20 }], 'done'), true);
    for (const game of games.slice(1)) assert.equal(await adapter.saveScore(game.id, draw, 'done'), true);
    const before = await state();
    assert.equal(before.matches.filter(m => m.phase !== 'group').length, 0);
    for (const status of ['done', 'active']) {
      assert.equal(await adapter.saveScore(games[0].id, draw, status), false);
      assert.deepEqual(await state(), before);
    }
    await request('/admin/advance-bracket', {});
    const seeded = await state();
    assert.equal(await adapter.saveScore(games[0].id, draw, 'done'), false);
    assert.deepEqual(await state(), seeded);
    await adapter.saveScores([{ id: games[0].id, sets: draw, status: 'done' }]);
    assert.deepEqual(await state(), seeded);
  });

  await t.test('D1 freezes completed semifinal winners before final seeding', async () => {
    const adapter = createDatabase(await mf.getD1Database('DB'));
    const semis = (await state()).matches.filter(m=>m.phase==='gold_sf');
    for(const semi of semis) assert.equal(await adapter.saveScore(semi.id,[{n:1,t1:25,t2:20},{n:2,t1:25,t2:20}],'done'),true);
    const before = await state();
    for(const semi of semis) {
      assert.equal(await adapter.saveScore(semi.id,[{n:1,t1:20,t2:25}],'done'),false);
    }
    assert.deepEqual(await state(),before);
    const database=await mf.getD1Database('DB');
    await database.prepare("CREATE TRIGGER fail_final BEFORE INSERT ON matches WHEN NEW.phase='gold_final' BEGIN SELECT RAISE(ABORT,'final rollback'); END").run();
    assert.equal((await request('/admin/advance-bracket',{})).status,500);
    assert.match(await(await request('/admin')).text(),/Retry bracket creation/);
    await database.prepare('DROP TRIGGER fail_final').run();
    assert.equal((await request('/admin/advance-bracket',{})).status,302);
    assert.equal(await adapter.saveScore(semis[0].id,[],'active'),false);
  });

  await t.test('D1 withdrawal and regeneration recheck eligibility atomically and preserve remaining teams', async () => {
    await seedSeven();
    let adapter=createDatabase(await mf.getD1Database('DB'));
    let before=await state(), missing=before.teams.at(-1);
    let remaining=before.teams.filter(team=>team.id!==missing.id);
    let replacement=tournament.generateLeagueSchedule(remaining.map(team=>team.id));
    assert.equal(await adapter.regenerateSchedule(before.teams.map((t,i)=>({...t,id:i===0?99999:t.id})), replacement),false);
    assert.deepEqual(await state(),before);
    assert.equal((await request('/admin/withdraw-team',{teamId:missing.id,confirmReset:'yes'})).status,302);
    let current=await state();
    assert.deepEqual(current.teams,remaining);
    assert.equal(current.matches.length,15);
    assert.equal(current.mode.totalMatches,19);
    assert.ok(current.matches.every(m=>m.referee_team_id && m.timed_periods===2 && m.estimated_minutes===20));
    assert.equal(await adapter.withdrawTeam(current.teams[0].id,current.teams.slice(1),[]),false);
    for(const m of current.matches) {
      assert.equal((await request('/admin/match/'+m.id+'/score',{s1t1:'20',s1t2:'18',s2t1:'20',s2t2:'18',finish:'yes'})).status,302);
    }
    current=await state();
    assert.equal(current.matches.filter(m=>m.phase==='gold_sf').length,2);
    assert.equal(current.matches.filter(m=>m.phase==='placement').length,1);
    for(const m of current.matches.filter(m=>m.phase!=='group')){
      assert.equal((await request('/admin/match/'+m.id+'/score',{s1t1:'25',s1t2:'20',s2t1:'25',s2t2:'20'})).status,302);
    }
    const fallbackFinal=(await state()).matches.find(m=>m.phase==='gold_final');
    assert.doesNotMatch(await(await request('/')).text(),/Tournament complete/);
    assert.equal((await request('/admin/match/'+fallbackFinal.id+'/score',{s1t1:'25',s1t2:'20',s2t1:'20',s2t2:'25',s3t1:'15',s3t2:'13'})).status,302);
    for(const route of ['/','/admin']){
      const response=await request(route);assert.equal(response.status,200);const html=await response.text();
      assert.match(html,/Tournament complete/);assert.match(html,/Final standings/);
      assert.equal((html.match(/data-final-rank=/g)||[]).length,6);
    }

    await seedSeven();
    before=await state();missing=before.teams.at(-1);
    remaining=before.teams.filter(t=>t.id!==missing.id);
    replacement=tournament.generateLeagueSchedule(remaining.map(t=>t.id));
    const first=before.matches[0];
    await adapter.updateMatchStatus(first.id,'active');
    before=await state();
    assert.equal(await adapter.withdrawTeam(missing.id,remaining,replacement),false);
    assert.equal(await adapter.regenerateSchedule(before.teams,tournament.generateLeagueSchedule(before.teams.map(t=>t.id))),false);
    assert.deepEqual(await state(),before);
    await adapter.updateMatchStatus(first.id,'pending');
    await adapter.upsertSet(first.id,1,12,10);
    before=await state();
    assert.equal(await adapter.withdrawTeam(missing.id,remaining,replacement),false);
    assert.equal(await adapter.regenerateSchedule(before.teams,tournament.generateLeagueSchedule(before.teams.map(t=>t.id))),false);
    assert.deepEqual(await state(),before);
    await seedSeven();
    before=await state();missing=before.teams.at(-1);
    remaining=before.teams.filter(t=>t.id!==missing.id);
    await assert.rejects(adapter.withdrawTeam(missing.id,remaining,[{court:1,team1_id:-1,team2_id:-2}]));
    assert.deepEqual(await state(),before);
  });

  await t.test('D1 team setup preserves IDs and logos, handles replacements, and refuses stale or started resets', async()=>{
    await seedSeven();
    const adapter=createDatabase(await mf.getD1Database('DB'));
    let before=await state();
    const html=await(await request('/admin/setup')).text();
    const version=html.match(/name="rosterVersion" value="([a-f0-9]+)"/)[1];
    const kept=before.teams.slice(0,6);
    const fields=[['rosterVersion',version],['confirmReset','yes'],...kept.flatMap(t=>[['teamId',String(t.id)],['name',t.name]]),['teamId',''],['name','Replacement']];
    assert.equal((await request('/admin/setup',fields)).status,302);
    let current=await state();
    assert.equal(current.matches.length,21);
    for(const t of kept)assert.deepEqual(current.teams.find(row=>row.id===t.id),t);
    assert.ok(current.teams.some(t=>t.name==='Replacement'));
    assert.equal((await request('/admin/setup',fields)).status,409);
    assert.deepEqual(await state(),current);
    const named=teams=>tournament.generateLeagueSchedule(teams.map(t=>t.id)).map(m=>({...m,team1_name:teams.find(t=>t.id===m.team1_id).name,team2_name:teams.find(t=>t.id===m.team2_id).name,referee_name:teams.find(t=>t.id===m.referee_team_id).name}));
    let desired=current.teams.map(t=>({id:t.id,name:t.name}));
    [desired[0].name,desired[1].name]=[desired[1].name,desired[0].name];
    assert.equal(await adapter.saveTeamSetup(current.teams,desired,named(desired)),true);
    current=await state();
    assert.equal(current.teams.find(t=>t.id===desired[0].id).name,desired[0].name);
    const database=await mf.getD1Database('DB');
    await database.prepare("CREATE TRIGGER fail_setup BEFORE INSERT ON matches BEGIN SELECT RAISE(ABORT,'setup rollback'); END").run();
    before=await state();
    await assert.rejects(adapter.saveTeamSetup(before.teams,before.teams,named(before.teams)));
    assert.deepEqual(await state(),before);
    await database.prepare('DROP TRIGGER fail_setup').run();
    const first=before.matches[0];
    await adapter.updateMatchStatus(first.id,'active');
    before=await state();
    assert.equal(await adapter.saveTeamSetup(before.teams,before.teams,named(before.teams)),false);
    assert.deepEqual(await state(),before);
    await adapter.updateMatchStatus(first.id,'pending');
    await adapter.upsertSet(first.id,1,12,10);
    before=await state();
    assert.equal(await adapter.saveTeamSetup(before.teams,before.teams,named(before.teams)),false);
    assert.deepEqual(await state(),before);
    const readOnly=await request('/admin/match/'+first.id+'/score');
    assert.equal(readOnly.status,200);
    assert.deepEqual(await state(),before);
    assert.equal(await adapter.saveScore(-999,[],'done'),false);
    assert.equal((await database.prepare("SELECT count(*) AS n FROM settings WHERE key='setup_guard'").first()).n,0);
  });

  await t.test('custom hosted passwords have no minimum length', async () => {
    for (const pin of ['x', '1234']) {
      await mf.dispose();
      await start(pin);
      assert.equal((await request('/admin/login', { pin: 'wrong-password' }, false)).status, 200);
      const login = await request('/admin/login', { pin }, false);
      assert.equal(login.status, 302);
      cookie = login.headers.get('set-cookie').split(';')[0];
      assert.equal((await request('/admin')).status, 200);
    }
  });
  await t.test('an unconfigured hosted password keeps admin access disabled', async () => {
    await mf.dispose();
    await start('');
    assert.equal((await request('/admin/login', { pin: '1234' }, false)).status, 503);
    assert.equal((await request('/admin')).status, 503);
    assert.equal((await request('/')).status, 200);
  });
});
