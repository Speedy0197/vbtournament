function getMatchWinner(sets) {
  let t1Sets = 0, t2Sets = 0;
  for (const s of sets) {
    if (s.team1_score > s.team2_score) t1Sets++;
    else if (s.team2_score > s.team1_score) t2Sets++;
  }
  if (t1Sets === 2) return 1;
  if (t2Sets === 2) return 2;
  return null;
}

function calculateStandings(teams, matches) {
  const stats = {};
  for (const team of teams) {
    stats[team.id] = {
      team,
      wins: 0, losses: 0,
      setsWon: 0, setsLost: 0,
      pointsFor: 0, pointsAgainst: 0,
    };
  }

  for (const match of matches) {
    const winner = getMatchWinner(match.sets || []);
    if (!winner) continue;

    const winnerId = winner === 1 ? match.team1_id : match.team2_id;
    const loserId  = winner === 1 ? match.team2_id : match.team1_id;
    if (!stats[winnerId] || !stats[loserId]) continue;

    stats[winnerId].wins++;
    stats[loserId].losses++;

    for (const s of (match.sets || [])) {
      stats[match.team1_id].setsWon     += s.team1_score > s.team2_score ? 1 : 0;
      stats[match.team1_id].setsLost    += s.team2_score > s.team1_score ? 1 : 0;
      stats[match.team2_id].setsWon     += s.team2_score > s.team1_score ? 1 : 0;
      stats[match.team2_id].setsLost    += s.team1_score > s.team2_score ? 1 : 0;
      stats[match.team1_id].pointsFor   += s.team1_score;
      stats[match.team1_id].pointsAgainst += s.team2_score;
      stats[match.team2_id].pointsFor   += s.team2_score;
      stats[match.team2_id].pointsAgainst += s.team1_score;
    }
  }

  return Object.values(stats).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aSetR = a.setsLost ? a.setsWon / a.setsLost : a.setsWon;
    const bSetR = b.setsLost ? b.setsWon / b.setsLost : b.setsWon;
    if (Math.abs(bSetR - aSetR) > 0.0001) return bSetR - aSetR;
    const aPtsR = a.pointsAgainst ? a.pointsFor / a.pointsAgainst : a.pointsFor;
    const bPtsR = b.pointsAgainst ? b.pointsFor / b.pointsAgainst : b.pointsFor;
    return bPtsR - aPtsR;
  });
}

function generateRoundRobin(teamIds) {
  const pairs = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      pairs.push([teamIds[i], teamIds[j]]);
    }
  }
  return pairs;
}

module.exports = { getMatchWinner, calculateStandings, generateRoundRobin };
