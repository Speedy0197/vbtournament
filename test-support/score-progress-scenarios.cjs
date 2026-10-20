const assert=require('node:assert/strict');
module.exports=async function scoreProgressScenarios(t,{db,req,state}){
 const route=m=>'/admin/match/'+m.id+'/score',pair={s1t1:'15',s1t2:'12'},full={...pair,s2t1:'29',s2t2:'27'};
 async function seed(){await db.replaceTeams(Array.from({length:7},(_,i)=>({name:'Progress '+(i+1)})),'league');assert.equal((await req('/admin/generate-schedule',{})).status,302);return (await state()).matches;}
 async function playoffs(){for(const m of await seed())assert.equal((await req(route(m),full)).status,302);return (await state()).matches.filter(m=>m.phase!=='group');}
 await t.test('one timed set is active, survives reopening, and publishes only the committed update',async()=>{
  const first=(await seed())[0],initial=await req('/api/state'),result=await req(route(first),pair);assert.equal(result.status,302);assert.match(result.headers.get('location'),/scoreSaved=1/);
  const current=await state(),saved=current.matches[0];assert.equal(saved.status,'active');assert.equal(saved.completed_at,null,'a partial set must not start the next round timing');assert.deepEqual(saved.sets.map(s=>[s.set_number,s.team1_score,s.team2_score]),[[1,15,12]]);assert.ok(current.standings.A.every(r=>r.leaguePoints===0));assert.equal(current.matches.length,21);
  const form=await(await req(route(first))).text();assert.match(form,/value="15"/);assert.doesNotMatch(form,/<input[^>]*name="s2t[12]"[^>]*required/);
  const updated=await req('/api/state');assert.ok(updated.headers.get('X-Scores-Version'));assert.notEqual(updated.headers.get('X-Scores-Version'),initial.headers.get('X-Scores-Version'));
  assert.match(await(await req(result.headers.get('location'))).text(),/name="scores-saved"/);assert.equal((await req('/api/state')).headers.get('X-Scores-Version'),updated.headers.get('X-Scores-Version'));
 });
 await t.test('partial results lock their court and seeding waits for the final league set',async()=>{
  const games=await seed(),first=games[0],other=games.find(m=>m.id!==first.id&&m.court===first.court);assert.equal((await req(route(first),pair)).status,302);assert.equal((await req(route(other),full)).status,409);assert.equal(await db.saveScore(other.id,[{n:1,t1:15,t2:12}],'active',other),false);
  assert.equal((await req(route(first),full)).status,302);for(const m of games.slice(1,-1))assert.equal((await req(route(m),full)).status,302);const last=games.at(-1);assert.equal((await req(route(last),pair)).status,302);assert.equal((await state()).matches.length,21);assert.equal((await req(route(last),full)).status,302);assert.equal((await state()).matches.filter(m=>m.phase==='gold_sf').length,2);
 });
 await t.test('a changed referee is checked against active games inside the score transaction',async()=>{
  const games=await seed(),target=games[0],other=games.find(m=>m.court!==target.court);
  assert.equal(await db.saveScore(other.id,[{n:1,t1:15,t2:12}],'active',other),true);
  await db.updateMatchReferee(target.id,other.team1_id);
  assert.equal((await state()).matches.find(m=>m.id===target.id).referee_team_id,other.team1_id);
  const before=await state();assert.equal(await db.saveScore(target.id,[{n:1,t1:15,t2:12}],'active',target),false);assert.deepEqual(await state(),before);
 });
 await t.test('15-point semifinals and extended sets advance the final one set at a time',async()=>{
  const bracket=await playoffs(),semis=bracket.filter(m=>m.phase==='gold_sf'),first=semis[0];assert.equal((await req(route(first),pair)).status,302);assert.equal((await state()).matches.find(m=>m.id===first.id).status,'active');const split={...pair,s2t1:'12',s2t2:'15'};assert.equal((await req(route(first),split)).status,302);assert.equal((await state()).matches.find(m=>m.id===first.id).status,'active');assert.equal((await req(route(first),{...split,s3t1:'29',s3t2:'27'})).status,302);
  assert.equal((await req(route(semis[1]),{s1t1:'11',s1t2:'15',s2t1:'12',s2t2:'15'})).status,302);const current=await state(),final=current.matches.find(m=>m.phase==='gold_final');assert.ok(final);assert.deepEqual([final.team1_id,final.team2_id],[first.team1_id,semis[1].team2_id]);assert.equal((await req(route(final),full)).status,302);assert.equal((await state()).matches.find(m=>m.id===final.id).status,'done');for(const m of current.matches.filter(m=>m.phase==='placement'))assert.equal((await req(route(m),full)).status,302);assert.match(await(await req('/')).text(),/Tournament complete/);
 });
 await t.test('placements count only completed games and the public table lists each team once with W/D/L',async()=>{
  const m=(await playoffs()).find(m=>m.phase==='placement');assert.equal((await req(route(m),pair)).status,302);assert.ok((await state()).placementStandings.every(r=>r.leaguePoints===0));assert.equal((await req(route(m),full)).status,302);assert.equal((await state()).placementStandings.reduce((sum,r)=>sum+r.wins,0),1);
  const html=await(await req('/')).text(),table=html.match(/<table[^>]*id="current-standings"[\s\S]*?<\/table>/)?.[0];assert.ok(table);assert.equal((table.match(/data-standing-team=/g)||[]).length,7);for(const team of(await state()).teams)assert.equal((table.match(new RegExp('data-standing-team="'+team.id+'"','g'))||[]).length,1);for(const heading of ['W','D','L'])assert.match(table,new RegExp('<th[^>]*>'+heading+'<'));
 });
 await t.test('invalid pairs, gaps and extra sets cannot change progress or reopen completed matches',async()=>{
  const first=(await playoffs()).find(m=>m.phase==='gold_sf');assert.equal((await req(route(first),pair)).status,302);const before=await state();for(const invalid of [{},{s1t1:'15'},{s2t1:'15',s2t2:'12'},{s1t1:'15',s1t2:'15'},{s1t1:'-1',s1t2:'12'},{s1t1:'15.5',s1t2:'12'},{s1t1:'10000',s1t2:'12'},{...full,s3t1:'15',s3t2:'12'}]){assert.equal((await req(route(first),invalid)).status,400);assert.deepEqual(await state(),before);}assert.equal((await req(route(first),full)).status,302);const done=await state();assert.equal((await req(route(first),pair)).status,400);assert.deepEqual(await state(),done);
 });
 await t.test('a stale form cannot erase a saved set or publish a save notification',async()=>{
  const first=(await seed())[0],form=await(await req(route(first))).text(),version=form.match(/name="scoreVersion" value="([a-f0-9]+)"/)[1];assert.equal((await req(route(first),{...pair,scoreVersion:version})).status,302);const before=await state(),stale=await req(route(first),{...full,scoreVersion:version});assert.equal(stale.status,409);assert.doesNotMatch(await stale.text(),/name="scores-saved"/);assert.deepEqual(await state(),before);
 });
};
