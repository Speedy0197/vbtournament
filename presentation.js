function time(match) { return (match.label || '').match(/\d{2}:\d{2}–\d{2}:\d{2}/)?.[0] || ''; }
function phase(match) { return match.phase === 'group' ? 'League' : match.label || (match.phase === 'placement' ? 'Placement' : 'Playoff'); }
function team(match, side) { return { name: match['team'+side+'_name'] || 'To be decided', icon_path: match['team'+side+'_icon'] }; }
function referee(match) { return { name: match.referee_name || (match.phase==='gold_sf' && match.label==='Semifinal 2' ? 'Loser of semifinal 1' : 'To be assigned'), icon_path: match.referee_icon }; }
function nextByCourt(matches) {
 return [1,2].map(court => matches.find(m=>m.court===court&&m.status==='active')
  || matches.find(m=>m.court===court&&m.status==='pending')
  || [...matches].reverse().find(m=>m.court===court&&m.status==='done')).filter(Boolean);
}
function blocked(match,matches) { return match.phase!=='group' && match.status!=='done' && matches.some(m=>m.phase!=='group'&&m.court===match.court&&m.id<match.id&&m.status!=='done'); }
function adminQueue(matches) {
 const priority=m=>m.status==='active'?0:blocked(m,matches)?2:1;
 return matches.filter(m=>m.status!=='done').sort((a,b)=>priority(a)-priority(b)||a.id-b.id);
}
function result(match) { const sets=match.sets||[]; return {a:sets.filter(s=>s.team1_score>s.team2_score).length,b:sets.filter(s=>s.team2_score>s.team1_score).length}; }
function finalResults(teams,matches) {
 const count=teams.length;
 if(![6,7].includes(count)||matches.some(m=>m.status!=='done'))return null;
 const league=matches.filter(m=>m.phase==='group');
 const semis=matches.filter(m=>m.phase==='gold_sf').sort((a,b)=>a.id-b.id);
 const finals=matches.filter(m=>m.phase==='gold_final');
 const placement=matches.filter(m=>m.phase==='placement');
 if(league.length!==count*(count-1)/2||semis.length!==2||finals.length!==1||placement.length!==(count===7?3:1))return null;
 const {getMatchWinner,calculateStandings}=require('./tournament');
 const winner=m=>getMatchWinner(m.sets||[],m);
 if([...semis,...finals,...placement].some(m=>winner(m)===null))return null;
 const final=finals[0],winnerId=m=>m['team'+winner(m)+'_id'];
 if(!semis.every(m=>[final.team1_id,final.team2_id].includes(winnerId(m))))return null;
 const byId=new Map(teams.map(t=>[t.id,t]));
 const finalists=[winnerId(final),final['team'+(winner(final)===1?2:1)+'_id']];
 const losers=semis.map(m=>m['team'+(winner(m)===1?2:1)+'_id']);
 const placementIds=new Set(placement.flatMap(m=>[m.team1_id,m.team2_id]));
 const bottom=calculateStandings(teams.filter(t=>placementIds.has(t.id)),placement,'league');
 const rows=[
  {rank:1,team:byId.get(finalists[0]),label:'Winner'},
  {rank:2,team:byId.get(finalists[1]),label:'Runner-up'},
  ...losers.map(id=>({rank:3,team:byId.get(id),label:'Joint third'})),
  ...bottom.map((r,i)=>({rank:i+5,team:r.team,label:'Placement round'}))
 ];
 if(rows.length!==count||rows.some(r=>!r.team)||new Set(rows.map(r=>r.team.id)).size!==count)return null;
 return {rows,final};
}
module.exports={finalResults,time,phase,team,referee,nextByCourt,blocked,adminQueue,result};
