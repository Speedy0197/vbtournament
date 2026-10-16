const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

// Run a copy of the app so setup/seed cannot touch real data or team uploads.
test('fixed tournament persists schedules and scores through restart', async t => {
  const testRoot = path.join(__dirname, '.superpowers');
  await fs.mkdir(testRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(testRoot, 'six-team-test-'));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    assert.equal(path.dirname(dir), testRoot);
    assert.ok(path.basename(dir).startsWith('six-team-test-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  for (const file of ['server.js', 'app.js', 'local-icons.js', 'db.js', 'tournament.js', 'presentation.js', 'score-corrections.js', 'views', 'migrations']) {
    await fs.cp(path.join(__dirname, file), path.join(dir, file), { recursive: true });
  }
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  async function start() {
    child = spawn(process.env.TEST_NODE || process.execPath, ['server.js'], {
      cwd: dir,
      env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'test.db'), ADMIN_PIN: 'mode-test-pin' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Server did not start: ' + output)), 10000);
      child.on('error', err => { clearTimeout(timer); reject(err); });
      child.on('exit', code => { clearTimeout(timer); reject(new Error('Server exited ' + code + ': ' + output)); });
      child.stderr.on('data', data => { output += data; });
      child.stdout.on('data', data => {
        output += data;
        if (output.includes('Running on')) { clearTimeout(timer); resolve(); }
      });
    });
  }
  function request(route, fields, authenticated = true) {
    return new Promise((resolve, reject) => {
      const body = fields ? new URLSearchParams(fields).toString() : '';
      const req = http.request({ hostname: '127.0.0.1', port, path: route, method: fields ? 'POST' : 'GET', headers: {
        ...(authenticated ? { Cookie: 'admin=mode-test-pin' } : {}),
        ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}),
      } }, res => {
        let text = '';
        res.on('data', data => { text += data; });
        res.on('end', () => resolve({ status: res.statusCode, text, location: res.headers.location }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  const state = async () => JSON.parse((await request('/api/state')).text);
  require('node:child_process').execFileSync(process.execPath, ['-e',
    'require("./db").replaceTeams(Array.from({length:7},(_,i)=>({name:"Team "+(i+1)})),"league");'],
    {cwd:dir,env:{...process.env,DB_PATH:path.join(dir,'test.db')},windowsHide:true});
  await start();
  await t.test('schedule actions require authentication and explicit regeneration confirmation', async()=>{
    assert.equal((await request('/admin/generate-schedule',{},false)).location,'/admin/login');
    assert.equal((await request('/admin/generate-schedule',{})).status,302);
    const before=await state();
    assert.equal(before.matches.length,21);
    assert.equal((await request('/admin/generate-schedule',{})).status,409);
    assert.deepEqual(await state(),before);
    assert.equal((await request('/admin/generate-schedule',{confirmReset:'yes'})).status,302);
    const current=await state();
    assert.deepEqual(current.teams,before.teams);
    assert.ok(current.matches.every(m=>m.status==='pending'&&m.sets.length===0&&m.timed_periods===2));
  });
  await t.test('opening score entry and Back keep games pending; saving completes the result',async()=>{
    const before=await state(),first=before.matches[0];
    for(const m of before.matches.slice(0,4))assert.equal((await request('/admin/match/'+m.id+'/score')).status,200);
    assert.deepEqual(await state(),before);
    assert.equal((await request('/admin/match/'+first.id+'/score',{s1t1:'20',s1t2:'19',s2t1:'19',s2t2:'20'})).status,302);
    assert.equal((await state()).matches[0].status,'done');
  });
  await t.test('fixed rules, scores and schedule survive restart and all event screens render',async()=>{
    const before=await state();
    assert.equal((await request('/admin/generate-schedule',{confirmReset:'yes'})).status,409);
    assert.deepEqual(await state(),before);
    const stopped=once(child,'exit');child.kill();await stopped;await start();
    assert.deepEqual(await state(),before);
    for(const route of ['/','/qr','/admin','/admin/setup','/admin/print']){
      assert.equal((await request(route)).status,200,route);
    }
    for(const route of ['/admin/test','/admin/test/seed','/admin/test/fill']){
      assert.equal((await request(route,route==='/admin/test'?undefined:{})).status,404);
    }
    assert.deepEqual((await state()).rules,{setTarget:25,decidingSetTarget:15,matchMinutes:40,playoffSetsToWin:2});
  });
});

test('local schema upgrade preserves existing set scores and scoring rules', async t => {
  const testRoot = path.join(__dirname, '.superpowers');
  await fs.mkdir(testRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(testRoot, 'league-migration-'));
  const filename = path.join(dir, 'legacy.db');
  t.after(async () => {
    assert.equal(path.dirname(dir), testRoot);
    assert.ok(path.basename(dir).startsWith('league-migration-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const legacy = new (require('better-sqlite3'))(filename);
  legacy.exec(await fs.readFile(path.join(__dirname, 'migrations/0001_initial.sql'), 'utf8'));
  legacy.exec("INSERT INTO teams (id,name,group_name) VALUES (1,'Alpha','A'),(2,'Beta','A'); INSERT INTO matches (id,phase,court,team1_id,team2_id,status) VALUES (1,'group',1,1,2,'done'); INSERT INTO sets (match_id,set_number,team1_score,team2_score) VALUES (1,1,25,20),(1,2,25,18); INSERT INTO settings (key,value) VALUES ('tournament_mode','single');");
  legacy.close();
  const output = require('node:child_process').execFileSync(process.env.TEST_NODE || process.execPath,
    ['-e', 'const db=require("./db");process.stdout.write(JSON.stringify(db.getFullState()));'],
    { cwd: __dirname, env: { ...process.env, DB_PATH: filename }, encoding: 'utf8', windowsHide: true });
  const state = JSON.parse(output);
  assert.equal(state.matches[0].scoring_format, 'sets');
  assert.equal(state.matches[0].status, 'done');
  assert.equal(state.matches[0].set_target, 25);
  assert.deepEqual(state.matches[0].sets.map(s => [s.team1_score, s.team2_score]), [[25,20],[25,18]]);
});

test('timed score persistence freezes completed league results before playoff seeding', () => {
  const script = `
    const assert = require('node:assert/strict');
    const db = require('./db');
    db.replaceTeams([{name:'A'},{name:'B'},{name:'C'},{name:'D'}], 'league');
    db.saveSchedule('league', db.getTeams(), [
      {court:1,team1_id:1,team2_id:2,scoring_format:'timed',estimated_minutes:25},
      {court:2,team1_id:3,team2_id:4,scoring_format:'timed',estimated_minutes:25}
    ]);
    const draw = [{n:1,t1:20,t2:20}];
    db.saveScore(1,draw,'done');
    db.saveScore(1,[{n:1,t1:21,t2:20}],'done');
    db.saveScore(2,draw,'done');
    const before = db.getFullState();
    const saved = db.saveScore(1,draw,'done');
    assert.deepEqual(db.getFullState(),before);
    assert.equal(saved,false);
    assert.equal(db.saveScore(1,draw,'active'),false);
    assert.deepEqual(db.getFullState(),before);
  `;
  require('node:child_process').execFileSync(process.env.TEST_NODE || process.execPath, ['-e', script],
    { cwd: __dirname, env: { ...process.env, DB_PATH: ':memory:' }, windowsHide: true });
});

test('semifinal results freeze atomically before and after final seeding', () => {
  const script = `
    const assert = require('node:assert/strict');
    const db = require('./db');
    db.replaceTeams([{name:'A'},{name:'B'},{name:'C'},{name:'D'}], 'league');
    db.insertBracketMatches([['gold_sf',1,1,4,'Semifinal 1',{sets_to_win:1}],['gold_sf',1,2,3,'Semifinal 2',{sets_to_win:1}]]);
    const score = [{n:1,t1:25,t2:20}];
    db.saveScore(1,score,'done');
    db.saveScore(2,score,'done');
    const before = db.getFullState();
    assert.equal(db.saveScore(1,[{n:1,t1:20,t2:25}],'done'),false);
    assert.deepEqual(db.getFullState(),before);
    db.insertBracketMatches([['gold_final',1,1,2,'Final',{sets_to_win:1}]]);
    assert.equal(db.saveScore(2,[],'active'),false);
  `;
  require('node:child_process').execFileSync(process.execPath,['-e',script],
    {cwd:__dirname,env:{...process.env,DB_PATH:':memory:'},windowsHide:true});
});
