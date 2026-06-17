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

    if (!stats[match.team1_id] || !stats[match.team2_id]) continue;
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
    const aSetR = a.setsLost === 0 ? Infinity : a.setsWon / a.setsLost;
    const bSetR = b.setsLost === 0 ? Infinity : b.setsWon / b.setsLost;
    if (Math.abs(bSetR - aSetR) > 0.0001) return bSetR - aSetR;
    const aPtsR = a.pointsAgainst === 0 ? Infinity : a.pointsFor / a.pointsAgainst;
    const bPtsR = b.pointsAgainst === 0 ? Infinity : b.pointsFor / b.pointsAgainst;
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

// Circle method: returns rounds where each team plays exactly once per round.
// teamIds.length must be even.
function generateRoundsByRound(teamIds) {
  const n = teamIds.length;
  if (n < 2) return [];
  const fixed = teamIds[0];
  const rotating = teamIds.slice(1);
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const round = [[fixed, rotating[0]]];
    for (let i = 1; i < n / 2; i++) {
      round.push([rotating[i], rotating[n - 1 - i]]);
    }
    rounds.push(round);
    rotating.push(rotating.shift());
  }
  return rounds;
}

module.exports = { getMatchWinner, calculateStandings, generateRoundRobin, generateRoundsByRound };
