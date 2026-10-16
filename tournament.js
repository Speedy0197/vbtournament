const TOURNAMENT_RULES = Object.freeze({ setTarget: 25, decidingSetTarget: 15, matchMinutes: 40, playoffSetsToWin: 2 });

function getMatchWinner(sets, rules = null, setsToWin = rules?.sets_to_win ?? 2) {
  let t1Sets = 0, t2Sets = 0;
  for (const [index, s] of sets.entries()) {
    if (rules) {
      const target = index === 2 ? rules.deciding_set_target : rules.set_target;
      if (Math.max(s.team1_score, s.team2_score) < target || Math.abs(s.team1_score - s.team2_score) < 2) return null;
    }
    if (s.team1_score > s.team2_score) t1Sets++;
    else if (s.team2_score > s.team1_score) t2Sets++;
  }
  const needed = setsToWin;
  if (t1Sets === needed) return 1;
  if (t2Sets === needed) return 2;
  return null;
}

function getTimedWinner(match) {
  const sets = match.sets || [];
  const periods = match.timed_periods || 1;
  if (sets.length !== periods) return null;
  if (periods === 2 && sets.some(s => s.team1_score === s.team2_score)) return null;
  const balance = sets.reduce((total, s) => total + Math.sign(s.team1_score - s.team2_score), 0);
  return balance === 0 ? 0 : balance > 0 ? 1 : 2;
}

function getFixedSetWinner(sets, rules = null) {
  if (sets.length !== 2 || sets.some(s => s.team1_score === s.team2_score)) return null;
  if (rules && sets.some(s => Math.max(s.team1_score, s.team2_score) < rules.set_target
    || Math.abs(s.team1_score - s.team2_score) < 2)) return null;
  const wins = sets.filter(s => s.team1_score > s.team2_score).length;
  return wins === 1 ? 0 : wins === 2 ? 1 : 2;
}

function calculateStandings(teams, matches, format = 'sets') {
  const stats = {};
  for (const team of teams) {
    stats[team.id] = { team, wins: 0, draws: 0, losses: 0, leaguePoints: 0,
      setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0, pointDifference: 0 };
  }
  for (const match of matches) {
    if (match.status !== 'done') continue;
    const sets = match.sets || [];
    const a = stats[match.team1_id], b = stats[match.team2_id];
    if (!a || !b) continue;
    const timed = match.scoring_format === 'timed';
    const winner = timed ? getTimedWinner(match) : match.fixed_sets === 2 ? getFixedSetWinner(sets) : getMatchWinner(sets, null, match.sets_to_win ?? 2);
    if (winner === null) continue;
    if (winner === 0) {
      a.draws++; b.draws++; a.leaguePoints++; b.leaguePoints++;
    } else {
      const won = winner === 1 ? a : b, lost = winner === 1 ? b : a;
      won.wins++; won.leaguePoints += 2; lost.losses++;
    }
    for (const s of sets) {
      a.setsWon += s.team1_score > s.team2_score ? 1 : 0;
      a.setsLost += s.team2_score > s.team1_score ? 1 : 0;
      b.setsWon += s.team2_score > s.team1_score ? 1 : 0;
      b.setsLost += s.team1_score > s.team2_score ? 1 : 0;
      a.pointsFor += s.team1_score; a.pointsAgainst += s.team2_score;
      b.pointsFor += s.team2_score; b.pointsAgainst += s.team1_score;
    }
    a.pointDifference = a.pointsFor - a.pointsAgainst;
    b.pointDifference = b.pointsFor - b.pointsAgainst;
  }
  return Object.values(stats).sort((a, b) => {
    if (format === 'league') return b.leaguePoints - a.leaguePoints
      || b.pointDifference - a.pointDifference || b.pointsFor - a.pointsFor || a.team.id - b.team.id;
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

// Circle method: at most one match per team in each round.
// Odd-sized groups get a rotating bye, which is omitted from the matches.
function generateRoundsByRound(teamIds) {
  if (teamIds.length < 2) return [];
  const participants = [...teamIds];
  if (participants.length % 2 !== 0) participants.push(null);
  const n = participants.length;
  const fixed = participants[0];
  const rotating = participants.slice(1);
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const round = [[fixed, rotating[0]]];
    for (let i = 1; i < n / 2; i++) {
      round.push([rotating[i], rotating[n - 1 - i]]);
    }
    rounds.push(round.filter(pair => !pair.includes(null)));
    rotating.push(rotating.shift());
  }
  return rounds;
}

// Pair disjoint matches on the two courts. Any unpaired matches run on court 1
// after the paired slots, keeping both court queues free of team conflicts.
function generateRoundRobinSchedule(teamIds) {
  const remaining = generateRoundsByRound(teamIds).flat();
  const scheduled = [];
  const singles = [];
  while (remaining.length > 0) {
    const first = remaining.shift();
    const partnerIndex = remaining.findIndex(pair => pair.every(id => !first.includes(id)));
    if (partnerIndex === -1) {
      singles.push(first);
    } else {
      const second = remaining.splice(partnerIndex, 1)[0];
      scheduled.push({ court: 1, team1_id: first[0], team2_id: first[1] });
      scheduled.push({ court: 2, team1_id: second[0], team2_id: second[1] });
    }
  }
  return scheduled.concat(singles.map(([team1_id, team2_id]) => ({ court: 1, team1_id, team2_id })));
}

// Match each court duty to a team idle on both courts in that slot.
// A small capacity graph first fills equal quotas, then distributes the remainder.
function assignLeagueReferees(matches, teamIds) {
  const scheduled = matches.map(match => ({ ...match }));
  const slots = new Map(), counters = {};
  for (const match of scheduled) {
    const court = match.court || 1;
    const slot = counters[court] || 0;
    counters[court] = slot + 1;
    if (!slots.has(slot)) slots.set(slot, []);
    slots.get(slot).push(match);
  }
  const graph = [];
  const node = () => (graph.push([]), graph.length - 1);
  const source = node(), sink = node();
  const edge = (from, to, capacity) => {
    const forward = { to, capacity, reverse: graph[to].length };
    const backward = { to: from, capacity: 0, reverse: graph[from].length };
    graph[from].push(forward); graph[to].push(backward);
    return forward;
  };
  const teamNodes = new Map(teamIds.map(id => [id, node()]));
  const quota = Math.floor(matches.length / teamIds.length);
  const limits = teamIds.map(id => edge(teamNodes.get(id), sink, quota));
  const choices = new Map();
  for (const games of slots.values()) {
    const playing = new Set(games.flatMap(match => [match.team1_id, match.team2_id]));
    const idle = teamIds.filter(id => !playing.has(id));
    const dutyNodes = new Map(idle.map(id => [id, node()]));
    for (const id of idle) edge(dutyNodes.get(id), teamNodes.get(id), 1);
    for (const match of games) {
      const gameNode = node();
      edge(source, gameNode, 1);
      choices.set(match, idle.map(id => ({ id, edge: edge(gameNode, dutyNodes.get(id), 1) })));
    }
  }
  let flow = 0;
  function fill() {
    while (true) {
      const previous = Array(graph.length).fill(null), queue = [source];
      previous[source] = { from: source };
      for (let i = 0; i < queue.length && !previous[sink]; i++) {
        const from = queue[i];
        graph[from].forEach((candidate, index) => {
          if (candidate.capacity > 0 && !previous[candidate.to]) {
            previous[candidate.to] = { from, index };
            queue.push(candidate.to);
          }
        });
      }
      if (!previous[sink]) return;
      for (let current = sink; current !== source;) {
        const { from, index } = previous[current];
        const candidate = graph[from][index];
        candidate.capacity--;
        graph[current][candidate.reverse].capacity++;
        current = from;
      }
      flow++;
    }
  }
  fill();
  if (flow < matches.length) {
    for (const limit of limits) limit.capacity++;
    fill();
  }
  if (flow !== matches.length) throw new Error('Cannot assign idle referee teams to every match.');
  for (const match of scheduled) match.referee_team_id = choices.get(match).find(choice => choice.edge.capacity === 0).id;
  return scheduled;
}


const LEAGUE_GAME_MINUTES = 20;
const LEAGUE_BREAK_MINUTES = 5;
const clock = minutes => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
const leagueLabel = (slot, start) => 'Slot ' + (slot + 1) + ' · ' + clock(start) + '–' + clock(start + LEAGUE_GAME_MINUTES) + ' · 2 × 10 min';

function getTournamentFormat(teamCount, leagueEndMinutes = null) {
  const groupMatchCount = teamCount * (teamCount - 1) / 2;
  const placementTeams = Math.max(0, teamCount - 4);
  const placementMatchCount = placementTeams * (placementTeams - 1) / 2;
  const groupSlots = Math.ceil(groupMatchCount / 2);
  const groupBreakMinutes = Math.max(0, groupSlots - 1) * LEAGUE_BREAK_MINUTES;
  const groupMinutes = groupSlots * LEAGUE_GAME_MINUTES + groupBreakMinutes;
  const playMinutes = groupMinutes + 3 * TOURNAMENT_RULES.matchMinutes;
  // The existing 65-minute allowance already included breaks. Reserve the
  // remaining allowance for playoffs/delays rather than counting breaks twice.
  const reserveMinutes = Math.max(0, 65 - groupBreakMinutes);
  const groupFinishMinutes = leagueEndMinutes ?? 10 * 60 + groupMinutes;
  const finishMinutes = groupFinishMinutes + 3 * TOURNAMENT_RULES.matchMinutes + reserveMinutes;
  const finish = clock(finishMinutes);
  return {
    id: 'league', name: 'League + semifinals + final', format: 'league',
    minTeams: 6, maxTeams: 7, groupSizes: [teamCount], groupMatchCount, playoffMatchCount: 3,
    placementMatchCount, totalMatches: groupMatchCount + 3 + placementMatchCount,
    formatName: teamCount + ' teams — timed league + playoffs',
    description: 'One league, top four in the semifinals. Remaining teams play each other once on Court 2.',
    timing: {
      matchMinutes: 40, groupSlots, groupSlotMinutes: 25, groupBreakMinutes, groupMinutes, playMinutes, reserveMinutes,
      groupFinish: clock(groupFinishMinutes), finish, fitsWindow: finishMinutes <= 17 * 60,
      description: groupSlots + ' league rounds at 20 minutes with 5-minute breaks, then three Court 1 matches estimated at 40 minutes each; Court 2 runs in parallel. With ' + reserveMinutes + ' additional minutes for breaks and delays, estimated finish ' + finish + '.',
    },
  };
}

function generateLeagueSchedule(teamIds) {
  if (![6, 7].includes(teamIds.length)) throw new Error('This tournament requires six or seven teams.');
  const matches = assignLeagueReferees(generateRoundRobinSchedule(teamIds), teamIds);
  const courtSlots = { 1: 0, 2: 0 };
  for (const match of matches) {
    const slot = courtSlots[match.court]++;
    const start = 10 * 60 + slot * (LEAGUE_GAME_MINUTES + LEAGUE_BREAK_MINUTES);
    Object.assign(match, { scoring_format: 'timed', timed_periods: 2, estimated_minutes: 20,
      label: leagueLabel(slot, start) });
  }
  return matches;
}

// Both courts share a round: its next start can be anchored only once every
// result in the round is saved. Missing legacy timestamps retain estimates.
function applyLeagueTiming(matches) {
  const projected = matches.map(match => ({ ...match }));
  const rounds = [], counters = {};
  for (const match of [...projected].sort((a,b) => a.id - b.id)) {
    if (match.phase !== 'group' || match.scoring_format !== 'timed' || match.timed_periods !== 2) continue;
    const slot = counters[match.court] || 0;
    counters[match.court] = slot + 1;
    (rounds[slot] ||= []).push(match);
  }
  const berlinTime = new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/Berlin', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
  let start = 10 * 60, completedPrefix = true;
  for (const [slot, games] of rounds.entries()) {
    const end = start + LEAGUE_GAME_MINUTES;
    for (const match of games) Object.assign(match, {
      label: leagueLabel(slot, start), scheduled_start_minutes: start, scheduled_end_minutes: end,
    });
    completedPrefix = completedPrefix && games.every(match => match.status === 'done');
    let finished = end;
    if (completedPrefix) for (const match of games) {
      const timestamp = Date.parse(match.completed_at);
      if (!Number.isFinite(timestamp)) continue;
      // Round up so the displayed start always leaves at least five minutes.
      const [hour, minute] = berlinTime.format(new Date(Math.ceil(timestamp / 60000) * 60000)).split(':').map(Number);
      finished = Math.max(finished, hour * 60 + minute);
    }
    if (completedPrefix) for (const match of games) match.round_finished_minutes = finished;
    start = finished + LEAGUE_BREAK_MINUTES;
  }
  return projected;
}

module.exports = { TOURNAMENT_RULES, getTournamentFormat, generateLeagueSchedule, applyLeagueTiming, assignLeagueReferees, getFixedSetWinner, getTimedWinner, generateRoundRobinSchedule, getMatchWinner, calculateStandings, generateRoundRobin, generateRoundsByRound };
