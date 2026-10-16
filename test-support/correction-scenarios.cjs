const assert=require('node:assert/strict');
const tournament=require('../tournament');
module.exports=async function correctionScenarios(t,{db,req,state,sql}){
 const score=m=>'/admin/match/'+m.id+'/score';
 const win={s1t1:'25',s1t2:'20',s2t1:'25',s2t2:'20'};
 const lose={s1t1:'20',s1t2:'25',s2t1:'20',s2t2:'25'};
 async function seed(n=7){
  await db.replaceTeams(Array.from({length:n},(_,i)=>({name:'Team '+(i+1),emoji:'logo-'+i})),'league');
  const teams=(await db.getFullState()).teams;
  await db.saveSchedule('league',teams,tournament.generateLeagueSchedule(teams.map(t=>t.id)));
  for(const m of (await state()).matches){const a=m.team1_id<m.team2_id?20:10,b=30-a;assert.equal(await db.saveScore(m.id,[{n:1,t1:a,t2:b},{n:2,t1:a,t2:b}],'done'),true);}
  assert.equal((await req('/admin/advance-bracket',{})).status,302);
  const s=await state(),ids=s.standings.A.map(r=>r.team.id);
  return {s,ids,semis:s.matches.filter(m=>m.phase==='gold_sf'),placements:s.matches.filter(m=>m.phase==='placement'),target:s.matches.find(m=>m.phase==='group'&&[m.team1_id,m.team2_id].includes(ids[3])&&[m.team1_id,m.team2_id].includes(ids[4]))};
 }
 const flip=m=>m.team1_id<m.team2_id?{s1t1:'10',s1t2:'20',s2t1:'10',s2t2:'20'}:{s1t1:'20',s1t2:'10',s2t1:'20',s2t2:'10'};
 for(const n of [6,7])await t.test(n+' teams: correcting the league reseeds pending semifinals and placement with the same match IDs',async()=>{
  const {s,ids,target,semis}=await seed(n);
  const html=await(await req(score(target))).text();assert.doesNotMatch(html,/readonly|disabled>Save result/);
  assert.equal((await req(score(target),flip(target))).status,302);
  const now=await state();assert.deepEqual(now.teams,s.teams);assert.deepEqual(now.matches.map(m=>m.id),s.matches.map(m=>m.id));
  assert.deepEqual([now.matches.find(m=>m.id===semis[0].id).team1_id,now.matches.find(m=>m.id===semis[0].id).team2_id],[ids[0],ids[4]]);
  const placements=now.matches.filter(m=>m.phase==='placement');assert.ok(placements.every(m=>![m.team1_id,m.team2_id].includes(ids[4])));assert.ok(placements.some(m=>[m.team1_id,m.team2_id].includes(ids[3])));
  assert.ok(placements.every(m=>![m.team1_id,m.team2_id].includes(m.referee_team_id)));
  for(const m of now.matches.filter(m=>m.phase==='group'&&m.id!==target.id))assert.deepEqual(m,s.matches.find(old=>old.id===m.id));
  assert.match(await(await req('/admin')).text(),/Edit result/);
 });
 await t.test('an unaffected completed placement game survives a league correction',async()=>{
  const {ids,target,placements}=await seed();const unaffected=placements.find(m=>[m.team1_id,m.team2_id].includes(ids[5])&&[m.team1_id,m.team2_id].includes(ids[6]));
  await db.saveScore(unaffected.id,[{n:1,t1:25,t2:20},{n:2,t1:25,t2:20}],'done');
  const old=(await state()).matches.find(m=>m.id===unaffected.id);
  assert.equal((await req(score(target),flip(target))).status,302);
  assert.deepEqual((await state()).matches.find(m=>m.id===old.id),old);
 });
 await t.test('a changed qualifier cannot replace a team in a played or started semifinal',async()=>{
  for(const status of ['done','active','partial']){
   const {target,semis}=await seed();
   if(status==='done')await req(score(semis[0]),win);
   else if(status==='active')await db.updateMatchStatus(semis[0].id,'active');
   else await db.upsertSet(semis[0].id,1,10,8);
   const before=await state();const response=await req(score(target),flip(target));assert.equal(response.status,409);assert.match(await response.text(),/already|played|started|result/i);assert.deepEqual(await state(),before);
  }
 });
 await t.test('a semifinal winner can be corrected after both semis, updating an unplayed final',async()=>{
  const {semis,ids}=await seed();for(const m of semis)assert.equal((await req(score(m),win)).status,302);
  const before=await state(),final=before.matches.find(m=>m.phase==='gold_final'),second=before.matches.find(m=>m.id===semis[1].id);
  assert.equal((await req(score(semis[0]),lose)).status,302);
  const after=await state(),updated=after.matches.find(m=>m.id===final.id);
  assert.deepEqual([updated.team1_id,updated.team2_id],[ids[3],ids[1]]);assert.equal(updated.referee_team_id,ids[2]);assert.equal(updated.status,'pending');assert.equal(updated.sets.length,0);
  assert.deepEqual(after.matches.find(m=>m.id===second.id),second);
  assert.equal((await req(score(semis[1]),{s1t1:'25',s1t2:'20',s2t1:'20',s2t2:'25',s3t1:'13',s3t2:'15'})).status,302);
  const last=(await state()).matches.find(m=>m.id===final.id);assert.deepEqual([last.team1_id,last.team2_id,last.referee_team_id],[ids[3],ids[2],ids[1]]);
 });
 await t.test('played final prevents changing its entrants but allows a harmless score correction',async()=>{
  const {semis}=await seed();for(const m of semis)await req(score(m),win);const final=(await state()).matches.find(m=>m.phase==='gold_final');await req(score(final),win);
  const before=await state();assert.equal((await req(score(semis[0]),lose)).status,409);assert.deepEqual(await state(),before);
  assert.equal((await req(score(semis[0]),{...win,s1t2:'19'})).status,302);assert.deepEqual((await state()).matches.find(m=>m.id===final.id),before.matches.find(m=>m.id===final.id));
  const group=before.matches.find(m=>m.phase==='group'&&m.team1_id<m.team2_id);
  const current=await state();assert.equal((await req(score(group),{s1t1:'21',s1t2:'10',s2t1:'20',s2t2:'10'})).status,302);
  assert.deepEqual((await state()).matches.filter(m=>m.phase!=='group'),current.matches.filter(m=>m.phase!=='group'));
 });
 await t.test('an open score form cannot save against changed teams or overwrite a newer correction',async()=>{
  const {target,semis}=await seed();const html=await(await req(score(semis[0]))).text(),version=html.match(/name="scoreVersion" value="([a-f0-9]+)"/)?.[1];assert.ok(version);
  assert.equal((await req(score(target),flip(target))).status,302);let before=await state();assert.equal((await req(score(semis[0]),{...win,scoreVersion:version})).status,409);assert.deepEqual(await state(),before);
  const source=before.matches.find(m=>m.id===target.id),form=await(await req(score(source))).text(),sourceVersion=form.match(/name="scoreVersion" value="([a-f0-9]+)"/)[1];
  assert.equal((await req(score(source),{...flip(target),s1t1:'11',scoreVersion:sourceVersion})).status,302);
  before=await state();assert.equal((await req(score(source),{...flip(target),scoreVersion:sourceVersion})).status,409);assert.deepEqual(await state(),before);
 });
 await t.test('stale result writers and bracket advancement cannot overwrite a corrected bracket',async()=>{
  const {target,semis}=await seed();const rawBefore=await db.getFullState(),staleSemi=rawBefore.matches.find(m=>m.id===semis[0].id);
  assert.equal((await req(score(target),flip(target))).status,302);let before=await state();
  assert.equal(await db.saveScore(staleSemi.id,[{n:1,t1:25,t2:20},{n:2,t1:25,t2:20}],'done',staleSemi),false);assert.deepEqual(await state(),before);
  assert.equal((await db.correctScore(target.id,[{n:1,t1:20,t2:10},{n:2,t1:20,t2:10}],rawBefore.matches.find(m=>m.id===target.id))).ok,false);assert.deepEqual(await state(),before);
  assert.equal(await db.insertBracketMatches([['gold_final',1,semis[0].team1_id,semis[1].team1_id,'Gold Final 🥇']],rawBefore),false);assert.deepEqual(await state(),before);
  assert.equal(await db.updateMatchReferee(semis[1].id,semis[0].team1_id,rawBefore),false);assert.deepEqual(await state(),before);
 });
 await t.test('a failed bracket update rolls back the corrected score and all participant changes',async()=>{
  const {target,semis}=await seed();const before=await state();
  await sql("CREATE TRIGGER fail_correction BEFORE UPDATE OF team1_id,team2_id ON matches WHEN OLD.id="+semis[0].id+" BEGIN SELECT RAISE(ABORT,'correction rollback'); END");
  try{assert.equal((await req(score(target),flip(target))).status,500);assert.deepEqual(await state(),before);}finally{await sql('DROP TRIGGER fail_correction');}
 });
};
