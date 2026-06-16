const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getMatchWinner, calculateStandings, generateRoundRobin } = require('./tournament');

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
