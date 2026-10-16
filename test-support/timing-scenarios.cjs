const assert=require('node:assert/strict');
const tournament=require('../tournament');
const scores={s1t1:'20',s1t2:'18',s2t1:'20',s2t2:'18'};

module.exports=async function timingScenarios(t,{db,req,state,sql}) {
  await db.replaceTeams(Array.from({length:7},(_,i)=>({name:'Timing team '+(i+1)})),'league');
  const teams=await db.getTeams();
  // Model the already-deployed timetable without rebuilding its pairings or IDs.
  const schedule=tournament.generateLeagueSchedule(teams.map(team=>team.id)).map((m,i)=>{
    const start=600+Math.floor(i/2)*20;
    const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
    return {...m,label:'Slot '+(Math.floor(i/2)+1)+' · '+clock(start)+'–'+clock(start+20)+' · 2 × 10 min'};
  });
  await db.saveSchedule('league',teams,schedule);
  const rawBefore=await db.getFullState();
  let current=await state();
  const games=current.matches;
  const route=m=>'/admin/match/'+m.id+'/score';
  const save=async(index,finished)=>{
    const before=Date.now();
    assert.equal((await req(route(games[index]),scores)).status,302);
    const saved=(await state()).matches[index];
    assert.ok(Date.parse(saved.completed_at)>=before&&Date.parse(saved.completed_at)<=Date.now(),'saving a first result must persist its finish time');
    await sql("UPDATE matches SET completed_at='"+finished+"' WHERE id="+games[index].id);
  };
  await t.test('existing schedule adopts breaks on every screen without changing stored matches',async()=>{
    assert.match(games[2].label,/10:25–10:45/);
    assert.match(games.at(-1).label,/14:10–14:30/);
    assert.deepEqual(await db.getFullState(),rawBefore);
    for(const path of ['/','/admin','/admin/print',route(games[2])]){
      const response=await req(path);assert.equal(response.status,200);
      assert.match(await response.text(),/10:25–10:45/,path);
    }
  });
  await t.test('one saved court result does not advance the synchronized round',async()=>{
    await save(0,'2026-10-17T08:21:00.000Z');
    assert.match((await state()).matches[2].label,/10:25–10:45/);
  });
  await t.test('second result shifts both courts and all future rounds in Berlin time',async()=>{
    await save(1,'2026-10-17T08:23:30.000Z');
    current=await state();
    assert.match(current.matches[2].label,/10:29–10:49/);
    assert.equal(current.matches[2].label,current.matches[3].label);
    assert.match(current.matches.at(-1).label,/14:14–14:34/);
    assert.equal(current.mode.timing.groupFinish,'14:34');
    assert.equal(current.mode.timing.finish,'16:49');
    for(const path of ['/','/admin','/admin/print',route(games[2])]){
      const response=await req(path);assert.equal(response.status,200);
      assert.match(await response.text(),/10:29–10:49/,path);
    }
  });
  await t.test('a longer break carries through after the following round is scored',async()=>{
    await save(2,'2026-10-17T08:56:00.000Z');
    await save(3,'2026-10-17T08:58:00.000Z');
    assert.match((await state()).matches[4].label,/11:03–11:23/);
  });
  await t.test('correcting an old result preserves finish times and the remaining timetable',async()=>{
    const before=await state();
    assert.equal((await req(route(games[0]),{...scores,s1t1:'21'})).status,302);
    const after=await state();
    assert.deepEqual(after.matches.map(m=>[m.id,m.label,m.completed_at]),before.matches.map(m=>[m.id,m.label,m.completed_at]));
    assert.equal(after.matches[0].sets[0].team1_score,21);
  });
  await t.test('invalid and stale submissions cannot change finish times or estimates',async()=>{
    const before=await state();
    assert.equal((await req(route(games[4]),{s1t1:'20',s1t2:'18'})).status,400);
    assert.equal((await req(route(games[4]),{...scores,scoreVersion:'stale'})).status,409);
    assert.deepEqual(await state(),before);
  });
  await t.test('a late final league result updates the overall finish estimate',async()=>{
    const ends=['09:23','09:48','10:13','10:38','11:03','11:28','11:53','12:18'];
    for(let index=4;index<20;index++) await save(index,'2026-10-17T'+ends[Math.floor((index-4)/2)]+':00.000Z');
    await save(20,'2026-10-17T12:50:00.000Z');
    const after=await state();
    assert.equal(after.mode.timing.groupFinish,'14:50');
    assert.equal(after.mode.timing.finish,'17:05');
    assert.equal(after.mode.timing.fitsWindow,false);
  });
};
