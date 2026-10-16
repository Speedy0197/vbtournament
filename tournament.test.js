const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getMatchWinner, calculateStandings, generateRoundRobin, generateRoundsByRound, generateRoundRobinSchedule, getTournamentFormat, TOURNAMENT_RULES, generateLeagueSchedule } = require('./tournament');

// getMatchWinner
test('2-0: team1 wins', () => {
  const sets = [
    { team1_score: 25, team2_score: 18 },
    { team1_score: 25, team2_score: 20 },
  ];
  assert.equal(getMatchWinner(sets), 1);
});

test('2-1: team2 wins', () => {
  const sets = [
    { team1_score: 25, team2_score: 18 },
    { team1_score: 18, team2_score: 25 },
    { team1_score: 12, team2_score: 15 },
  ];
  assert.equal(getMatchWinner(sets), 2);
});

test('0-2: team2 wins', () => {
  const sets = [
    { team1_score: 18, team2_score: 25 },
    { team1_score: 20, team2_score: 25 },
  ];
  assert.equal(getMatchWinner(sets), 2);
});

test('1-1: no winner yet', () => {
  const sets = [
    { team1_score: 25, team2_score: 18 },
    { team1_score: 18, team2_score: 25 },
  ];
  assert.equal(getMatchWinner(sets), null);
});

test('empty sets: no winner', () => {
  assert.equal(getMatchWinner([]), null);
});

// calculateStandings
test('standings: win/loss counts', () => {
  const teams = [
    { id: 1, name: 'Alpha', group_name: 'A' },
    { id: 2, name: 'Beta', group_name: 'A' },
  ];
  const matches = [
    {
      id: 1, phase: 'group', team1_id: 1, team2_id: 2, status: 'done',
      sets: [
        { team1_score: 25, team2_score: 18 },
        { team1_score: 25, team2_score: 20 },
      ],
    },
  ];
  const standings = calculateStandings(teams, matches);
  assert.equal(standings[0].team.id, 1); // Alpha won
  assert.equal(standings[0].wins, 1);
  assert.equal(standings[0].losses, 0);
  assert.equal(standings[1].team.id, 2); // Beta lost
  assert.equal(standings[1].wins, 0);
  assert.equal(standings[1].losses, 1);
});

test('standings: set ratio tiebreaker', () => {
  const teams = [
    { id: 1, name: 'Alpha', group_name: 'A' },
    { id: 2, name: 'Beta', group_name: 'A' },
    { id: 3, name: 'Gamma', group_name: 'A' },
  ];
  const matches = [
    {
      id: 1, team1_id: 1, team2_id: 3, status: 'done',
      sets: [{ team1_score: 25, team2_score: 10 }, { team1_score: 25, team2_score: 10 }],
    },
    {
      id: 2, team1_id: 2, team2_id: 3, status: 'done',
      sets: [{ team1_score: 25, team2_score: 23 }, { team1_score: 23, team2_score: 25 }, { team1_score: 15, team2_score: 10 }],
    },
    {
      id: 3, team1_id: 1, team2_id: 2, status: 'done',
      sets: [{ team1_score: 18, team2_score: 25 }, { team1_score: 20, team2_score: 25 }],
    },
  ];
  const standings = calculateStandings(teams, matches);
  // Beta beats Alpha (2-0) and Gamma (2-1): 2W 0L
  // Alpha beats Gamma (2-0): 1W 1L
  // Gamma: 0W 2L
  assert.equal(standings[0].team.id, 2); // Beta first with 2 wins
  assert.equal(standings[0].wins, 2);
});

test('standings: set ratio tiebreaker with equal wins', () => {
  const teams = [
    { id: 1, name: 'Alpha', group_name: 'A' },
    { id: 2, name: 'Beta', group_name: 'A' },
    { id: 3, name: 'Gamma', group_name: 'A' },
  ];
  // Alpha beats Gamma 2-0 (sets: 25-10, 25-10)
  // Beta beats Gamma 2-0 (sets: 25-23, 25-23)
  // Alpha beats Beta 2-0 (sets: 25-20, 25-20)
  // Alpha: 2W 0L, sets 4:0, points 100:63
  // Beta: 1W 1L, sets 2:2, points 91:70
  // Gamma: 0W 2L
  const matches = [
    {
      id: 1, team1_id: 1, team2_id: 3, status: 'done',
      sets: [{ team1_score: 25, team2_score: 10 }, { team1_score: 25, team2_score: 10 }],
    },
    {
      id: 2, team1_id: 2, team2_id: 3, status: 'done',
      sets: [{ team1_score: 25, team2_score: 23 }, { team1_score: 25, team2_score: 23 }],
    },
    {
      id: 3, team1_id: 1, team2_id: 2, status: 'done',
      sets: [{ team1_score: 25, team2_score: 20 }, { team1_score: 25, team2_score: 20 }],
    },
  ];
  const standings = calculateStandings(teams, matches);
  assert.equal(standings[0].team.id, 1); // Alpha: 2W, set ratio Infinity
  assert.equal(standings[1].team.id, 2); // Beta: 1W, set ratio 1.0
  assert.equal(standings[2].team.id, 3); // Gamma: 0W
});

// generateRoundRobin
test('round robin produces n*(n-1)/2 pairs', () => {
  const pairs = generateRoundRobin([1, 2, 3, 4, 5]);
  assert.equal(pairs.length, 10); // 5*4/2
});

test('round robin: all unique pairs', () => {
  const pairs = generateRoundRobin([1, 2, 3]);
  assert.deepEqual(pairs.sort(), [[1, 2], [1, 3], [2, 3]].sort());
});

for (const [count, expectedRounds, expectedMatches] of [[3, 3, 3], [5, 5, 10], [6, 5, 15]]) {
  test(count + '-team group: every pair plays once without self-matches or double bookings', () => {
    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const rounds = generateRoundsByRound(ids);
    assert.equal(rounds.length, expectedRounds);
    assert.equal(rounds.flat().length, expectedMatches);
    const pairs = new Set();
    for (const round of rounds) {
      const playing = new Set();
      for (const [a, b] of round) {
        assert.ok(ids.includes(a) && ids.includes(b));
        assert.notEqual(a, b);
        assert.ok(!playing.has(a) && !playing.has(b));
        playing.add(a);
        playing.add(b);
        const key = [a, b].sort((x, y) => x - y).join('-');
        assert.ok(!pairs.has(key));
        pairs.add(key);
      }
    }
    for (const id of ids) {
      assert.equal(rounds.flat().filter(pair => pair.includes(id)).length, count - 1);
    }
    assert.deepEqual(ids, Array.from({ length: count }, (_, i) => i + 1));
  });
}

test('fewer than two teams cannot produce a match', () => {
  assert.deepEqual(generateRoundsByRound([]), []);
  assert.deepEqual(generateRoundsByRound([1]), []);
});

for (let count = 2; count <= 12; count++) {
  test(count + '-team single group fits on two courts without simultaneous team bookings', () => {
    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const matches = generateRoundRobinSchedule(ids);
    assert.equal(matches.length, count * (count - 1) / 2);
    const pairs = new Set(matches.map(m => [m.team1_id, m.team2_id].sort((a, b) => a - b).join('-')));
    assert.equal(pairs.size, matches.length);
    const court1 = matches.filter(m => m.court === 1);
    const court2 = matches.filter(m => m.court === 2);
    for (let slot = 0; slot < Math.max(court1.length, court2.length); slot++) {
      const playing = [court1[slot], court2[slot]].filter(Boolean).flatMap(m => [m.team1_id, m.team2_id]);
      assert.equal(new Set(playing).size, playing.length);
    }
    for (const id of ids) assert.equal(matches.filter(m => m.team1_id === id || m.team2_id === id).length, count - 1);
  });
}

for (const [count, league, total, finish] of [[6,15,19,'15:45'],[7,21,27,'16:45']]) {
  test(count + '-team fixed tournament keeps the same league and knockout rules', () => {
    const mode=getTournamentFormat(count);
    assert.equal(mode.format,'league');
    assert.equal(mode.groupMatchCount,league);
    assert.equal(mode.totalMatches,total);
    assert.equal(mode.minTeams,6); assert.equal(mode.maxTeams,7);
    assert.equal(mode.timing.groupSlotMinutes,20);
    assert.equal(mode.timing.finish,finish);
    assert.equal(mode.timing.fitsWindow,true);
    assert.deepEqual(TOURNAMENT_RULES,{setTarget:25,decidingSetTarget:15,matchMinutes:40,playoffSetsToWin:2});
  });
}
test('event schedule accepts only six or seven teams',()=>{
  for(const count of [0,5,8,12]) assert.throws(()=>generateLeagueSchedule(Array.from({length:count},(_,i)=>i+1)));
});

test('timed league counts draws, one-point wins, and only completed games', () => {
  const teams = [1, 2, 3].map(id => ({ id, name: 'Team ' + id }));
  const game = (a, b, x, y, status = 'done') => ({ team1_id: a, team2_id: b, status,
    scoring_format: 'timed', sets: [{ team1_score: x, team2_score: y }] });
  const standings = calculateStandings(teams, [game(1, 2, 20, 20), game(1, 3, 21, 20), game(2, 3, 100, 0, 'active')], 'league');
  assert.deepEqual(standings.map(s => [s.team.id, s.wins, s.draws, s.losses, s.leaguePoints, s.pointDifference]),
    [[1, 1, 1, 0, 3, 1], [2, 0, 1, 0, 1, 0], [3, 0, 0, 1, 0, -1]]);
});

test('league ties use point difference then points scored then stable seed order', () => {
  const teams = [3, 2, 1].map(id => ({ id, name: 'Team ' + id }));
  const games = [[1, 2, 10, 10], [1, 3, 20, 20], [2, 3, 30, 30]].map(([a, b, x, y]) => ({
    team1_id: a, team2_id: b, status: 'done', scoring_format: 'timed', sets: [{ team1_score: x, team2_score: y }],
  }));
  assert.deepEqual(calculateStandings(teams, games, 'league').map(s => s.team.id), [3, 2, 1]);
  assert.deepEqual(calculateStandings(teams, [], 'league').map(s => s.team.id), [1, 2, 3]);
});
