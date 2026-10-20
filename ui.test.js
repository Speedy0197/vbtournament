const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
process.env.DB_PATH=':memory:';
const db=require('./db'),createApp=require('./app');
async function fixture(t,count=7){
 db.replaceTeams(Array.from({length:count},(_,i)=>({name:'Team '+(i+1),emoji:i===0?'🏐':null})),'league');
 const app=createApp({db,icons:{clear:async()=>{}},adminPin:'ui-test'});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const req=(route,fields)=>fetch(base+route,{method:fields?'POST':'GET',redirect:'manual',
 headers:{Cookie:'admin=ui-test',...(fields?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
 ...(fields?{body:new URLSearchParams(fields)}:{})});
 const state=async()=> (await req('/api/state')).json();
 await req('/admin/generate-schedule',{});
 return {req,state};
}
test('score entry is read-only and offers only Save result and Back',async t=>{
 const {req,state}=await fixture(t),before=await state();
 const response=await req('/admin/match/'+before.matches[0].id+'/score');
 assert.equal(response.status,200);
 const html=await response.text();
 assert.match(html,/Save result/);assert.match(html,/>Back</);
 assert.doesNotMatch(html,/Save progress|Finish game|Pause|name="finish"/);
 assert.deepEqual(await state(),before);
});
test('Save result accepts one timed set and completes after the second without a finish flag',async t=>{
 const {req,state}=await fixture(t),before=await state(),route='/admin/match/'+before.matches[0].id+'/score';
 for(const invalid of [{},{s1t1:'12',s1t2:'10',s2t1:'10',s2t2:'10'}]){
  assert.equal((await req(route,invalid)).status,400);assert.deepEqual(await state(),before);
 }
 assert.equal((await req(route,{s1t1:'12',s1t2:'10'})).status,302);
 assert.equal((await state()).matches[0].status,'active');
 assert.equal((await req(route,{s1t1:'20',s1t2:'19',s2t1:'19',s2t2:'20'})).status,302);
 const current=await state();assert.equal(current.matches[0].status,'done');
 assert.equal(current.standings.A.find(s=>s.team.id===before.matches[0].team1_id).draws,1);
});
test('point-based results save progress and reject tied or extra sets',async t=>{
 const {req,state}=await fixture(t);
 for(const m of (await state()).matches)await req('/admin/match/'+m.id+'/score',{s1t1:'20',s1t2:'18',s2t1:'20',s2t2:'18',finish:'yes'});
 const semi=(await state()).matches.find(m=>m.phase==='gold_sf'),route='/admin/match/'+semi.id+'/score',before=await state();
 for(const invalid of [
  {s1t1:'25',s1t2:'20',s2t1:'25',s2t2:'20',s3t1:'15',s3t2:'10'},
  {s1t1:'25',s1t2:'25'},
  {s1t1:'25',s1t2:'20',s2t1:'20',s2t2:'25',s3t1:'15',s3t2:'15'}
 ]){assert.equal((await req(route,invalid)).status,400);assert.deepEqual(await state(),before);}
 assert.equal((await req(route,{s1t1:'25',s1t2:'20'})).status,302);
 assert.equal((await state()).matches.find(m=>m.id===semi.id).status,'active');
 assert.equal((await req(route,{s1t1:'25',s1t2:'20',s2t1:'20',s2t2:'25'})).status,302);
 assert.equal((await state()).matches.find(m=>m.id===semi.id).status,'active');
 assert.equal((await req(route,{s1t1:'25',s1t2:'20',s2t1:'20',s2t2:'25',s3t1:'16',s3t2:'14'})).status,302);
 assert.equal((await state()).matches.find(m=>m.id===semi.id).status,'done');
});
test('pre-play roster edits rebuild atomically and preserve unchanged logos and IDs',async t=>{
 const {req,state}=await fixture(t),before=await state();
 const setup=await(await req('/admin/setup')).text();
 const version=setup.match(/name="rosterVersion" value="([a-f0-9]+)"/)?.[1];
 assert.ok(version,'Setup must include a roster version');
 const roster=before.teams.slice(0,6);
 const fields=[['rosterVersion',version],...roster.flatMap(team=>[['teamId',String(team.id)],['name',team.name]]),
 ['teamId',''],['name','Replacement']];
 assert.equal((await req('/admin/setup',fields)).status,409);assert.deepEqual(await state(),before);
 assert.equal((await req('/admin/setup',[...fields,['confirmReset','yes']])).status,302);
 const current=await state();
 assert.equal(current.teams.length,7);assert.equal(current.matches.length,21);
 for(const original of roster)assert.deepEqual(current.teams.find(t=>t.id===original.id),original);
 assert.ok(current.teams.some(t=>t.name==='Replacement'));
 assert.ok(!current.teams.some(t=>t.id===before.teams.at(-1).id));
 assert.ok(current.matches.every(m=>m.status==='pending'&&m.sets.length===0&&m.timed_periods===2&&m.referee_team_id));
 assert.equal((await req('/admin/setup',[...fields,['confirmReset','yes']])).status,409);
 assert.deepEqual(await state(),current);
 const m=current.matches[0];await req('/admin/match/'+m.id+'/score',{s1t1:'20',s1t2:'18',s2t1:'20',s2t2:'18'});
 const scored=await state();
 const fresh=await(await req('/admin/setup')).text(),v=fresh.match(/name="rosterVersion" value="([a-f0-9]+)"/)?.[1]||version;
 assert.equal((await req('/admin/setup',[['rosterVersion',v],['confirmReset','yes'],...current.teams.flatMap(t=>[['teamId',String(t.id)],['name',t.name]])])).status,409);
 assert.deepEqual(await state(),scored);
});
test('public and admin layouts prioritize courts and do not expose format banners',async t=>{
 const {req}=await fixture(t);
 const html=await(await req('/')).text();
 assert.doesNotMatch(html,/7 teams — timed league|All teams/);
 assert.ok(html.indexOf('Next on court')<html.indexOf('League standings'));
 assert.match(html,/team-logo/);
 const admin=await(await req('/admin')).text();
 assert.match(admin,/Match desk/);assert.match(admin,/Teams &amp; setup/);
 assert.ok(admin.indexOf('Enter score')<admin.indexOf('Awaiting results'));
});

test('invalid roster submissions do not reset matches or replace teams',async t=>{
 const {req,state}=await fixture(t),before=await state();
 const html=await(await req('/admin/setup')).text(),version=html.match(/name="rosterVersion" value="([a-f0-9]+)"/)[1];
 const originals=before.teams.map(t=>({id:String(t.id),name:t.name}));
 const cases=[
  originals.slice(0,5),[...originals,{id:'',name:'Eighth'}],
  originals.map((t,i)=>i===0?{...t,name:''}:t),
  originals.map((t,i)=>i===0?{...t,name:originals[1].name}:t),
  originals.map((t,i)=>i===0?{...t,id:'99999'}:t),
  originals.map((t,i)=>i===0?{...t,id:'0'}:t),
  originals.map((t,i)=>i===0?{...t,id:'-1'}:t),
  originals.map((t,i)=>i===0?{...t,id:originals[1].id}:t)
 ];
 for(const rows of cases){
  const response=await req('/admin/setup',[['rosterVersion',version],['confirmReset','yes'],...rows.flatMap(t=>[['teamId',t.id],['name',t.name]])]);
  assert.equal(response.status,400);assert.deepEqual(await state(),before);
 }
 const named=before.matches.map(m=>({...m,team1_name:'Missing'}));
 assert.throws(()=>db.saveTeamSetup(before.teams,before.teams,named));
 assert.deepEqual(await state(),before);
 db.upsertSet(before.matches[0].id,1,12,10);
 const scored=await state();
 assert.equal(db.saveTeamSetup(before.teams,before.teams,before.matches),false);
 assert.deepEqual(await state(),scored);
 assert.equal(db.saveScore(-999,[],'done'),false);
});

test('a saved result survives advancement failure and Admin offers a final-seeding retry',async t=>{
 const {req,state}=await fixture(t);
 for(const m of (await state()).matches)await req('/admin/match/'+m.id+'/score',{s1t1:'20',s1t2:'18',s2t1:'20',s2t2:'18'});
 const semis=(await state()).matches.filter(m=>m.phase==='gold_sf');
 const original=db.insertBracketMatches;let fail=true;
 db.insertBracketMatches=matches=>{
  if(fail&&matches.some(m=>m[0]==='gold_final')){fail=false;throw new Error('simulated final creation failure');}
  return original(matches);
 };
 t.after(()=>{db.insertBracketMatches=original});
 for(const semi of semis){
  const response=await req('/admin/match/'+semi.id+'/score',{s1t1:'25',s1t2:'20',s2t1:'25',s2t2:'20'});
  assert.equal(response.status,302);
  if(semi.id===semis[1].id)assert.match(response.headers.get('location'),/advanceError/);
 }
 const current=await state();
 assert.ok(current.matches.filter(m=>m.phase==='gold_sf').every(m=>m.status==='done'));
 assert.equal(current.matches.filter(m=>m.phase==='gold_final').length,0);
 const html=await(await req('/admin?advanceError=1')).text();
 assert.match(html,/Result saved/);assert.match(html,/action="\/admin\/advance-bracket"/);assert.match(html,/Retry bracket creation/);
 assert.equal((await req('/admin/advance-bracket',{})).status,302);
 assert.equal((await state()).matches.filter(m=>m.phase==='gold_final').length,1);
});

test('Admin keeps unscored games ahead of completed results across phase changes',async t=>{
 const {req,state}=await fixture(t),games=(await state()).matches;
 await req('/admin/match/'+games[0].id+'/score',{s1t1:'20',s1t2:'18',s2t1:'20',s2t2:'18'});
 let html=await(await req('/admin')).text();
 assert.match(html,/Awaiting results/);assert.match(html,/<summary>Completed games \(1\)<\/summary>/);
 let queue=html.slice(html.indexOf('id="awaiting-results"'),html.indexOf('</section>',html.indexOf('id="awaiting-results"')));
 assert.ok(queue.includes('/admin/match/'+games[1].id+'/score'));assert.ok(!queue.includes('/admin/match/'+games[0].id+'/score'));
 for(const m of games.slice(1))await req('/admin/match/'+m.id+'/score',{s1t1:'20',s1t2:'18',s2t1:'20',s2t2:'18'});
 html=await(await req('/admin')).text();queue=html.slice(html.indexOf('id="awaiting-results"'),html.indexOf('</section>',html.indexOf('id="awaiting-results"')));
 assert.ok(queue.indexOf('Semifinal 1')<queue.indexOf('Placement game 1'));
 assert.ok(queue.indexOf('Placement game 1')<queue.indexOf('Semifinal 2'),'ready Court 2 game precedes blocked semifinal');
 assert.ok(html.indexOf('id="awaiting-results"')<html.indexOf('<summary>Completed games (21)</summary>'));
 assert.doesNotMatch(html,/<details[^>]*open[^>]*><summary>Completed games/);
});

for(const count of [6,7])test(count+'-team finished view ranks every team by playoff and placement results',async t=>{
 const ui=require('./presentation');
 const {req,state}=await fixture(t,count);
 const readFinal=async()=>{const s=await state();return ui.finalResults(s.teams,s.matches);};
 assert.equal(await readFinal(),null);
 const save=async(m,fields)=>assert.equal((await req('/admin/match/'+m.id+'/score',fields)).status,302);
 const straight={s1t1:'25',s1t2:'20',s2t1:'25',s2t2:'20'};
 const awayThird={s1t1:'25',s1t2:'20',s2t1:'20',s2t2:'25',s3t1:'13',s3t2:'15'};
 for(const m of (await state()).matches)await save(m,{s1t1:'20',s1t2:'18',s2t1:'20',s2t2:'18'});
 assert.equal(await readFinal(),null,'finishing the league must not finish the tournament');
 const semis=(await state()).matches.filter(m=>m.phase==='gold_sf');
 await save(semis[0],straight);await save(semis[1],awayThird);
 const final=(await state()).matches.find(m=>m.phase==='gold_final');
 await save(final,awayThird);
 assert.equal(await readFinal(),null,'the final alone cannot finish an unplayed placement round');
 assert.doesNotMatch(await(await req('/')).text(),/Tournament complete/);
 for(const m of (await state()).matches.filter(m=>m.phase==='placement'))await save(m,straight);
 const s=await state(),finished=await readFinal();
 assert.deepEqual(finished.rows.map(r=>r.rank),count===7?[1,2,3,3,5,6,7]:[1,2,3,3,5,6]);
 assert.deepEqual(finished.rows.map(r=>r.team.id),[
  final.team2_id,final.team1_id,semis[0].team2_id,semis[1].team1_id,
  ...s.placementStandings.map(r=>r.team.id)
 ]);
 assert.equal(new Set(finished.rows.map(r=>r.team.id)).size,count);
 for(const route of ['/','/admin']){
  const response=await req(route);assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/Tournament complete/);assert.match(html,/Final standings/);assert.match(html,/Joint third/);
  assert.ok(html.indexOf('Tournament complete')<html.indexOf('Final standings'));
  const summary=html.slice(html.indexOf('id="final-standings"'),html.indexOf('</table>',html.indexOf('id="final-standings"')));
  assert.equal((summary.match(/data-final-rank=/g)||[]).length,count);
  for(const team of s.teams)assert.ok(summary.includes(team.name));
  if(route==='/')assert.doesNotMatch(html,/League standings|Coming up|Next on court/);
  else assert.ok(html.indexOf('Final standings')<html.indexOf('Completed games'));
 }
 await save(final,straight);
 const corrected=await readFinal();
 assert.equal(corrected.rows[0].team.id,final.team1_id,'a final-score correction must update the winner');
 assert.equal(corrected.rows[1].team.id,final.team2_id);
});
