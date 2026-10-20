const {matchOrder,compareMatches}=require('./tournament');

const unplayed=match=>match?.status==='pending'&&match.sets.length===0;
const swapFields=['schedule_order','court','label','referee_team_id'];

// Move whole games between existing slots. Participants, results and IDs stay
// attached to the game; the court, position and displayed slot move together.
function planMatchSwap(state,firstId,secondId) {
  const first=state.matches.find(m=>m.id===firstId),second=state.matches.find(m=>m.id===secondId);
  if(!Number.isSafeInteger(firstId)||!Number.isSafeInteger(secondId)||firstId===secondId||!first||!second)
    return {ok:false,error:'Select two different upcoming matches.'};
  if(!unplayed(first)||!unplayed(second))return {ok:false,error:'Only matches that have not started and have no saved scores can be swapped.'};
  if(first.phase!==second.phase||!['group','gold_sf','placement'].includes(first.phase))
    return {ok:false,error:'Swap two league games, two semifinals or two placement games. The final must follow the semifinals.'};
  const matches=state.matches.map(m=>({...m})),byId=new Map(matches.map(m=>[m.id,m]));
  Object.assign(byId.get(firstId),{schedule_order:matchOrder(second),court:second.court,label:second.label});
  Object.assign(byId.get(secondId),{schedule_order:matchOrder(first),court:first.court,label:first.label});
  matches.sort(compareMatches);
  try {
    if(first.phase==='group')repairLeagueReferees(matches,state.teams,[firstId,secondId]);
    if(first.phase==='gold_sf') {
      const semis=matches.filter(m=>m.phase==='gold_sf');
      if(semis.length!==2||semis.some(m=>!unplayed(m))||matches.some(m=>m.phase==='gold_final'))throw new Error('Both semifinals must be unstarted and have no saved scores.');
      semis[0].referee_team_id=semis[1].team1_id;
      semis[1].referee_team_id=null;
      if(state.teams.length===6)for(const placement of matches.filter(m=>m.phase==='placement')) {
        if(unplayed(placement))placement.referee_team_id=semis[1].team2_id;
        else if(placement.status!=='done')throw new Error('Finish the active placement game before swapping semifinals; its referee is needed on Court 1.');
      }
    }
    const updates=matches.flatMap(m=>{
      const old=state.matches.find(original=>original.id===m.id);
      return swapFields.some(key=>old[key]!==m[key])?[Object.fromEntries(['id',...swapFields].map(key=>[key,m[key]??null]))]:[];
    });
    return {ok:true,updates};
  }catch(error){return {ok:false,error:error.message};}
}

function repairLeagueReferees(matches,teams,changedIds) {
  const rounds=[],counters={};
  for(const match of matches.filter(m=>m.phase==='group')) {
    const round=counters[match.court]||0;counters[match.court]=round+1;
    (rounds[round]||=[]).push(match);
  }
  const duties=new Map(teams.map(t=>[t.id,matches.filter(m=>m.phase==='group'&&m.referee_team_id===t.id).length]));
  for(const round of rounds.filter(games=>games.some(m=>changedIds.includes(m.id)))) {
    const players=round.flatMap(m=>[m.team1_id,m.team2_id]);
    if(new Set(players).size!==players.length)throw new Error('These matches would put a team on both courts in the same round. Choose another pair.');
    const occupied=new Set(players);
    for(const match of round.filter(m=>!unplayed(m))) {
      if(occupied.has(match.referee_team_id))throw new Error('This swap conflicts with a referee duty in a game that has already started.');
      occupied.add(match.referee_team_id);
    }
    const editable=round.filter(unplayed);
    for(const match of editable)duties.set(match.referee_team_id,(duties.get(match.referee_team_id)||0)-1);
    for(const match of editable) {
      const idle=teams.filter(t=>!occupied.has(t.id)).sort((a,b)=>duties.get(a.id)-duties.get(b.id)||a.id-b.id);
      const referee=idle.find(t=>t.id===match.referee_team_id)??idle[0];
      if(!referee)throw new Error('No idle referee team is available for this swap.');
      match.referee_team_id=referee.id;occupied.add(referee.id);duties.set(referee.id,duties.get(referee.id)+1);
    }
  }
}

module.exports={planMatchSwap,unplayed};
