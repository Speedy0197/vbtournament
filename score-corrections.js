const {calculateStandings,generateRoundRobin,getMatchWinner}=require('./tournament');
const pairKey=m=>[m.team1_id,m.team2_id].sort((a,b)=>a-b).join(':');
const unplayed=m=>m.status==='pending'&&m.sets.length===0;

// Plan only changes to existing pending games. Played games keep their identity,
// orientation, scores and historical referee, even when their seed order changes.
function planScoreCorrection(state,id,scores){
 const target=state.matches.find(m=>m.id===id);
 if(!target||target.status!=='done')return {ok:false,error:'This result changed. Reload the score form.'};
 const changed={...target,sets:scores.map(s=>({set_number:s.n,team1_score:s.t1,team2_score:s.t2}))};
 const updates=new Map();
 const current=m=>({...m,...updates.get(m.id)});
 function sync(match,a,b,referee){
  const m=current(match),desired={team1_id:a,team2_id:b,referee_team_id:referee??null};
  if(!unplayed(m)){
   if(pairKey(m)!==pairKey(desired))throw new Error('Cannot save this correction: '+(m.label||'a dependent game')+' has already started or has a saved result.');
   return m;
  }
  if(['team1_id','team2_id','referee_team_id'].some(key=>m[key]!==desired[key]))updates.set(m.id,{id:m.id,...desired});
  return current(match);
 }
 try{
  const matches=state.matches.map(m=>m.id===id?changed:m);
  const league=matches.filter(m=>m.phase==='group');
  let semis=matches.filter(m=>m.phase==='gold_sf');
  if(target.phase==='group'&&league.every(m=>m.status==='done')&&semis.length){
   const seeds=calculateStandings(state.teams,league,'league').map(r=>r.team.id);
   if(![6,7].includes(seeds.length)||semis.length!==2)return {ok:false,error:'The bracket changed. Reload Admin.'};
   // Original IDs identify the seeded pairings, even after the organiser moves
   // them to different slots. Play order controls referee and final duties.
   const seeded=[...semis].sort((a,b)=>a.id-b.id);
   sync(seeded[0],seeds[0],seeds[3],seeded[0].referee_team_id);
   sync(seeded[1],seeds[1],seeds[2],seeded[1].referee_team_id);
   const bottom=seeds.slice(4),pairs=generateRoundRobin(bottom),placement=matches.filter(m=>m.phase==='placement');
   if(placement.length!==pairs.length)return {ok:false,error:'The placement bracket changed. Reload Admin.'};
   const used=new Set(),assignments=pairs.map(([a,b])=>{
    const match=placement.find(m=>!used.has(m.id)&&pairKey(m)===pairKey({team1_id:a,team2_id:b}));
    if(match)used.add(match.id);return {a,b,match};
   });
   for(const item of assignments){if(!item.match){item.match=placement.find(m=>!used.has(m.id));used.add(item.match.id);}sync(item.match,item.a,item.b,bottom.find(id=>id!==item.a&&id!==item.b)??current(semis[1]).team2_id);}
  }
  if(target.phase==='group'||target.phase==='gold_sf'){
   semis=semis.map(current);
   if(semis.length===2){
    const [first,second]=semis,winners=semis.map(m=>m.status==='done'?getMatchWinner(m.sets,m):null);
    if(unplayed(first))sync(first,first.team1_id,first.team2_id,second.team1_id);
    if(unplayed(second))sync(second,second.team1_id,second.team2_id,winners[0]?(winners[0]===1?first.team2_id:first.team1_id):null);
    const final=matches.find(m=>m.phase==='gold_final');
    if(final&&winners.every(Boolean))sync(final,winners[0]===1?first.team1_id:first.team2_id,winners[1]===1?second.team1_id:second.team2_id,winners[1]===1?second.team2_id:second.team1_id);
   }
  }
  return {ok:true,updates:[...updates.values()]};
 }catch(error){return {ok:false,error:error.message};}
}

// These are the database values that affect correction eligibility and seeding.
function correctionSnapshot(state){
 return {
  teams:JSON.stringify(state.teams.map(t=>t.id).sort((a,b)=>a-b)),
  matches:JSON.stringify([...state.matches].sort((a,b)=>a.id-b.id).map(m=>[m.id,m.phase,m.court,m.team1_id,m.team2_id,m.referee_team_id,m.status,m.schedule_order??null])),
  sets:JSON.stringify([...state.matches].sort((a,b)=>a.id-b.id).flatMap(m=>[...m.sets].sort((a,b)=>a.set_number-b.set_number).map(s=>[m.id,s.set_number,s.team1_score,s.team2_score])))
 };
}
const matchSnapshot=m=>m?JSON.stringify([m.id,m.team1_id,m.team2_id,m.status,m.court,m.referee_team_id,m.schedule_order??null,m.sets.map(s=>[s.set_number,s.team1_score,s.team2_score])]):null;
module.exports={planScoreCorrection,correctionSnapshot,matchSnapshot};
