const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
process.env.DB_PATH=':memory:';
const db=require('./db');
const createApp=require('./app');
const tournament=require('./tournament');
const names=['Grüne Gurken','Hochball','Halb Netz Halb Aus','Netzfetzer','Netzflüsterer','Blockwürstchen','Petrus Team 26'];
async function fixture(t){
  db.replaceTeams(names.map((name,i)=>({name,emoji:i===0?'🏐':null})),'league');
  const app=createApp({db,icons:{clear:async()=>{}},adminPin:'fixed-test'});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const request=(route,fields,auth=true)=>fetch(base+route,{method:fields?'POST':'GET',redirect:'manual',
    headers:{...(auth?{Cookie:'admin=fixed-test'}:{}),...(fields?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
    ...(fields?{body:new URLSearchParams(fields)}:{})});
  return {request,state:async()=>(await request('/api/state')).json()};
}
test('fixed tournament exposes no mode, rule or test controls and rejects retired changes',async t=>{
  const {request,state}=await fixture(t);
  assert.equal((await request('/admin/generate-schedule',{})).status,302);
  const before=await state();
  const admin=await (await request('/admin')).text();
  assert.doesNotMatch(admin,/name="mode"|name="setTarget"|name="decidingSetTarget"|name="matchMinutes"|name="playoffSetsToWin"|href="\/admin\/test"/);
  assert.match(admin,/action="\/admin\/withdraw-team"/);
  const setup=await (await request('/admin/setup')).text();
  assert.doesNotMatch(setup,/6–12|12 teams/);
  assert.match(setup,/data-icon-upload/);
  assert.equal((await request('/admin/match-rules',{setTarget:'2',decidingSetTarget:'2',matchMinutes:'5',playoffSetsToWin:'1'})).status,410);
  assert.equal((await request('/admin/generate-schedule',{mode:'groups',confirmReset:'yes'})).status,400);
  assert.equal((await request('/admin/test')).status,404);
  assert.equal((await request('/admin/test/seed',{count:'12',mode:'groups'})).status,404);
  assert.equal((await request('/admin/test/fill',{})).status,404);
  assert.equal((await request('/admin/setup',{name:'Changed'})).status,409);
  assert.deepEqual(await state(),before);
  assert.deepEqual(before.rules,{setTarget:25,decidingSetTarget:15,matchMinutes:40,playoffSetsToWin:2});
  assert.equal(before.mode.minTeams,6);assert.equal(before.mode.maxTeams,7);
});
test('six-team fallback preserves remaining IDs and logos and rebuilds one fixed league',async t=>{
  const {request,state}=await fixture(t);
  await request('/admin/generate-schedule',{});
  const before=await state(),missing=before.teams.at(-1);
  assert.equal((await request('/admin/withdraw-team',{teamId:missing.id,confirmReset:'yes'},false)).status,302);
  assert.equal((await request('/admin/withdraw-team',{teamId:missing.id})).status,409);
  assert.equal((await request('/admin/withdraw-team',{teamId:'99999',confirmReset:'yes'})).status,400);
  assert.deepEqual(await state(),before);
  assert.equal((await request('/admin/withdraw-team',{teamId:missing.id,confirmReset:'yes'})).status,302);
  let current=await state();
  assert.deepEqual(current.teams,before.teams.filter(team=>team.id!==missing.id));
  assert.equal(current.matches.length,15);
  assert.equal(current.mode.format,'league');assert.equal(current.mode.totalMatches,19);
  assert.ok(current.matches.every(m=>m.status==='pending'&&m.scoring_format==='timed'&&m.timed_periods===2&&m.estimated_minutes===20&&m.referee_team_id));
  assert.equal(new Set(current.matches.map(m=>[m.team1_id,m.team2_id].sort().join('-'))).size,15);
  for(const team of current.teams)assert.equal(current.matches.filter(m=>[m.team1_id,m.team2_id].includes(team.id)).length,5);
  for(const match of current.matches)assert.equal((await request('/admin/match/'+match.id+'/score',{s1t1:'20',s1t2:'18',s2t1:'20',s2t2:'18',finish:'yes'})).status,302);
  current=await state();
  assert.equal(current.matches.filter(m=>m.phase==='gold_sf').length,2);
  assert.equal(current.matches.filter(m=>m.phase==='placement').length,1);
  assert.ok(current.matches.filter(m=>m.phase!=='group').every(m=>m.sets_to_win===2&&m.fixed_sets===0&&m.set_target===25&&m.deciding_set_target===15));
  assert.equal((await request('/admin/withdraw-team',{teamId:current.teams[0].id,confirmReset:'yes'})).status,409);
});
test('fallback refuses active or scored events and persistence enforces this atomically',async t=>{
  const {request,state}=await fixture(t);await request('/admin/generate-schedule',{});
  const current=await state(),first=current.matches[0],missing=current.teams.at(-1);
  db.updateMatchStatus(first.id,'active');
  let before=await state();
  assert.equal((await request('/admin/withdraw-team',{teamId:missing.id,confirmReset:'yes'})).status,409);
  assert.deepEqual(await state(),before);
  db.updateMatchStatus(first.id,'pending');
  db.upsertSet(first.id,1,12,10);
  before=await state();
  assert.equal((await request('/admin/withdraw-team',{teamId:missing.id,confirmReset:'yes'})).status,409);
  const remaining=before.teams.filter(team=>team.id!==missing.id);
  const replacement=tournament.generateLeagueSchedule(remaining.map(team=>team.id));
  assert.equal(db.withdrawTeam(missing.id,remaining,replacement),false);
  assert.deepEqual(await state(),before);
});
