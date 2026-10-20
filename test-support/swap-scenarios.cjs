const assert = require('node:assert/strict');
const tournament = require('../tournament');

module.exports = async function swapScenarios(t, {db, req, state, sql}) {
  const win = {s1t1:'25',s1t2:'20',s2t1:'25',s2t2:'20'};
  const score = m => '/admin/match/'+m.id+'/score';
  async function seed(n=7, playoffs=false) {
    await db.replaceTeams(Array.from({length:n},(_,i)=>({name:'Team '+(i+1),emoji:'logo-'+i})), 'league');
    const teams=(await db.getFullState()).teams;
    await db.saveSchedule('league',teams,tournament.generateLeagueSchedule(teams.map(t=>t.id)));
    if(playoffs) {
      for(const m of (await state()).matches) {
        const a=m.team1_id<m.team2_id?20:10,b=30-a;
        await db.saveScore(m.id,[{n:1,t1:a,t2:b},{n:2,t1:a,t2:b}],'done');
      }
      assert.equal((await req('/admin/advance-bracket',{})).status,302);
    }
    return state();
  }
  async function form() {
    const html=await (await req('/admin')).text();
    const version=html.match(/name="scheduleVersion" value="([a-f0-9]+)"/)?.[1];
    assert.ok(version,'Admin offers a guarded swap form when upcoming games exist');
    return {html,version};
  }
  async function swap(a,b,version) {
    return req('/admin/swap-matches',{firstMatchId:String(a.id),secondMatchId:String(b.id),scheduleVersion:version??(await form()).version});
  }
  for(const n of [6,7]) await t.test(n+' teams: swapping league slots preserves match identity and updates court, time, public view and print',async()=>{
    const before=await seed(n),[a,b]=before.matches;
    const version=(await req('/api/state')).headers.get('x-scores-version');
    const response=await swap(a,b);assert.equal(response.status,302);
    assert.match(response.headers.get('location'),/scoreSaved=1/);
    const after=await state();assert.deepEqual(after.teams,before.teams);
    assert.deepEqual(after.matches.slice(0,2).map(m=>m.id),[b.id,a.id]);
    for(const [original,slot] of [[a,b],[b,a]]) {
      const moved=after.matches.find(m=>m.id===original.id);
      assert.deepEqual([moved.team1_id,moved.team2_id,moved.referee_team_id],[original.team1_id,original.team2_id,original.referee_team_id]);
      assert.equal(moved.court,slot.court);assert.equal(moved.label,slot.label);
      assert.deepEqual(moved.sets,[]);assert.equal(moved.status,'pending');
    }
    assert.deepEqual(after.matches.slice(2),before.matches.slice(2));
    const publicHtml=await(await req('/')).text(),print=await(await req('/admin/print')).text();
    assert.ok(publicHtml.indexOf(b.team1_name)<publicHtml.indexOf(a.team1_name));
    const printSchedule=print.slice(print.indexOf('League schedule and results'));
    assert.ok(printSchedule.indexOf(b.team1_name)<printSchedule.indexOf(a.team1_name));
    assert.notEqual((await req('/api/state')).headers.get('x-scores-version'),version);
    assert.equal((await swap(a,b)).status,302);
    assert.deepEqual((await state()).matches.map(m=>m.id),before.matches.map(m=>m.id));
  });
  await t.test('league swaps reject simultaneous player conflicts without changing anything',async()=>{
    await seed(6);const teams=(await db.getFullState()).teams,ids=teams.map(t=>t.id);
    const games=[[1,0,1,4],[2,2,3,5],[1,0,2,4],[2,1,3,5]].map(([court,a,b,r])=>({court,team1_id:ids[a],team2_id:ids[b],referee_team_id:ids[r],scoring_format:'timed',timed_periods:2}));
    await db.saveSchedule('league',teams,games);
    const before=await state(),response=await swap(before.matches[0],before.matches[2]);
    assert.equal(response.status,409);assert.match(await response.text(),/same round|both courts|conflict/i);assert.deepEqual(await state(),before);
  });
  await t.test('a valid later league swap repairs idle referees while preserving played games',async()=>{
    await seed(7);const teams=(await db.getFullState()).teams,ids=teams.map(t=>t.id);
    const games=[[1,0,1,4],[2,2,3,5],[1,0,4,1],[2,2,3,6]].map(([court,a,b,r])=>({court,team1_id:ids[a],team2_id:ids[b],referee_team_id:ids[r],scoring_format:'timed',timed_periods:2}));
    await db.saveSchedule('league',teams,games);
    const before=await state();assert.equal((await swap(before.matches[0],before.matches[2])).status,302);
    const after=await state();
    for(let i=0;i<after.matches.length;i+=2) {
      const round=after.matches.slice(i,i+2),roles=round.flatMap(m=>[m.team1_id,m.team2_id,m.referee_team_id]);
      assert.equal(new Set(roles).size,roles.length,'no team plays or referees twice in a round');
    }
  });
  for(const n of [6,7]) await t.test(n+' teams: swapped semifinals retain seed pairings through corrections and advance in the new order',async()=>{
    const before=await seed(n,true),semis=before.matches.filter(m=>m.phase==='gold_sf'),ids=before.standings.A.map(r=>r.team.id);
    assert.equal((await swap(...semis)).status,302);
    let after=await state(),ordered=after.matches.filter(m=>m.phase==='gold_sf');
    assert.deepEqual(ordered.map(m=>m.id),[semis[1].id,semis[0].id]);
    assert.deepEqual([ordered[0].team1_id,ordered[0].team2_id,ordered[0].referee_team_id],[ids[1],ids[2],ids[0]]);
    assert.equal(ordered[0].label,'Semifinal 1');assert.equal(ordered[1].referee_team_id,null);
    if(n===6)assert.equal(after.matches.find(m=>m.phase==='placement').referee_team_id,ids[3]);
    // Harmless league corrections must not silently restore the default order or duties.
    const league=before.matches.find(m=>m.phase==='group'&&m.team1_id<m.team2_id);
    assert.equal((await req(score(league),{s1t1:'21',s1t2:'10',s2t1:'20',s2t2:'10'})).status,302);
    after=await state();ordered=after.matches.filter(m=>m.phase==='gold_sf');
    assert.deepEqual(ordered.map(m=>m.id),[semis[1].id,semis[0].id]);
    assert.deepEqual(ordered.map(m=>[m.team1_id,m.team2_id]),[[ids[1],ids[2]],[ids[0],ids[3]]]);
    assert.equal(ordered[0].referee_team_id,ids[0]);
    assert.equal((await req(score(ordered[1]))).status,409);
    assert.equal((await req(score(ordered[0]),win)).status,302);
    after=await state();assert.equal(after.matches.find(m=>m.id===ordered[1].id).referee_team_id,ids[2]);
    assert.equal((await req(score(ordered[1]),win)).status,302);
    const final=(await state()).matches.find(m=>m.phase==='gold_final');
    assert.deepEqual([final.team1_id,final.team2_id,final.referee_team_id],[ids[1],ids[0],ids[3]]);
  });
  await t.test('placement games can be swapped after an earlier placement result',async()=>{
    const before=await seed(7,true),games=before.matches.filter(m=>m.phase==='placement');
    assert.equal((await req(score(games[0]),win)).status,302);
    const played=(await state()).matches.find(m=>m.id===games[0].id);
    assert.equal((await swap(games[1],games[2])).status,302);
    const after=await state();assert.deepEqual(after.matches.find(m=>m.id===played.id),played);
    assert.deepEqual(after.matches.filter(m=>m.phase==='placement').map(m=>m.id),[games[0].id,games[2].id,games[1].id]);
    assert.equal((await req(score(games[2]),win)).status,302);
  });
  await t.test('active, completed and pending games with saved scores cannot be swapped',async()=>{
    for(const status of ['active','done','partial']) {
      const s=await seed(),[a,b]=s.matches;
      if(status==='partial')await db.upsertSet(a.id,1,15,12);
      else await db.updateMatchStatus(a.id,status);
      const before=await state();assert.equal((await swap(a,b)).status,409);assert.deepEqual(await state(),before);
    }
  });
  await t.test('stale swap forms and score forms cannot overwrite a changed schedule',async()=>{
    const before=await seed(),[a,b]=before.matches,version=(await form()).version;
    const scoreHtml=await(await req(score(a))).text(),scoreVersion=scoreHtml.match(/name="scoreVersion" value="([a-f0-9]+)"/)[1];
    const raw=await db.getFullState();
    assert.equal((await swap(a,b,version)).status,302);const after=await state();
    assert.equal((await swap(a,b,version)).status,409);assert.deepEqual(await state(),after);
    assert.equal((await req(score(a),{...win,scoreVersion})).status,409);assert.deepEqual(await state(),after);
    assert.equal((await db.swapMatches(a.id,b.id,raw)).ok,false);assert.deepEqual(await state(),after);
    assert.equal(await db.saveScore(a.id,[{n:1,t1:25,t2:20},{n:2,t1:25,t2:20}],'done',raw.matches[0]),false);
  });
  await t.test('invalid pairs, cross-phase swaps and missing version guards leave state unchanged',async()=>{
    const s=await seed(7,true),semis=s.matches.filter(m=>m.phase==='gold_sf'),placement=s.matches.find(m=>m.phase==='placement'),before=await state();
    for(const pair of [[semis[0],semis[0]],[semis[0],placement],[semis[0],{id:999999}]])assert.equal((await swap(...pair)).status,409);
    assert.equal((await req('/admin/swap-matches',{firstMatchId:String(semis[0].id),secondMatchId:String(semis[1].id)})).status,409);
    assert.deepEqual(await state(),before);
  });
  await t.test('a swap racing a score save is refused inside the database transaction',async()=>{
    const s=await seed(),[a,b]=s.matches,raw=await db.getFullState();
    await db.saveScore(a.id,[{n:1,t1:15,t2:12}],'active');const before=await state();
    assert.equal((await db.swapMatches(a.id,b.id,raw)).ok,false);assert.deepEqual(await state(),before);
  });
  await t.test('a failed swap rolls back order, courts and referees together',async()=>{
    const s=await seed(),[a,b]=s.matches,before=await state();
    await sql('CREATE TRIGGER fail_swap BEFORE UPDATE OF schedule_order ON matches WHEN OLD.id='+b.id+" BEGIN SELECT RAISE(ABORT,'swap rollback'); END");
    try {assert.equal((await swap(a,b)).status,500);assert.deepEqual(await state(),before);} finally {await sql('DROP TRIGGER fail_swap');}
  });
};
