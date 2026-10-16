const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { createHmac, createHash } = require('node:crypto');
const QRCode = require('qrcode/lib/core/qrcode');
const renderQR = require('qrcode/lib/renderer/svg-tag');
const tournament = require('./tournament');

function validImage(file) {
  const b = file.buffer;
  if (file.mimetype === 'image/png') return b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (file.mimetype === 'image/jpeg') return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (file.mimetype === 'image/gif') return /^GIF8[79]a$/.test(b.toString('ascii', 0, 6));
  return file.mimetype === 'image/webp' && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
}

module.exports = function createApp({ db, icons, adminPin, baseUrl, render, staticMiddleware, hosted = false }) {
const app = express();
const ui = require('./presentation');
app.locals.ui = ui;
const ADMIN_PIN = adminPin || null;
const cookieValue = hosted && adminPin ? createHmac('sha256', adminPin).update('tournament-admin-session').digest('hex') : adminPin;
app.disable('x-powered-by');
app.set('trust proxy', hosted ? 1 : false);
app.set('view engine', 'ejs');
if (staticMiddleware) app.use(staticMiddleware);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  if (render) res.render = (name, locals = {}) => res.type('html').send(render(name, { ui, ...locals }));
  next();
});
const wrap = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next);
const get = (route, ...handlers) => app.get(route, ...handlers.map(wrap));
const post = (route, ...handlers) => app.post(route, ...handlers.map(wrap));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
if (icons.get) get('/uploads/teams/:file', async (req, res) => {
  const icon = await icons.get(req.params.file, req.query.v);
  if (!icon) return res.status(404).send('Image not found');
  res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.type(icon.type).send(icon.bytes);
});

// ── Auth ─────────────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!ADMIN_PIN) return res.status(503).send('Admin access is not configured.');
  if (req.cookies.admin === cookieValue) return next();
  res.redirect('/admin/login');
}

get('/admin/login', async (req, res) => {
  res.render('login', {});
});

post('/admin/login', async (req, res) => {
  if (!ADMIN_PIN) return res.status(503).send('Admin access is not configured.');
  if (req.body.pin === ADMIN_PIN) {
    res.cookie('admin', cookieValue, { httpOnly: true, sameSite: 'strict', secure: hosted });
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Wrong PIN' });
  }
});

get('/admin/logout', async (req, res) => {
  res.clearCookie('admin');
  res.redirect('/');
});

// ── Helper: build state ───────────────────────────────────────────────────────
function currentMode(teams, groupMatches) {
  const last = groupMatches.at(-1);
  return tournament.getTournamentFormat(teams.length, last?.round_finished_minutes ?? last?.scheduled_end_minutes);
}

async function buildState() {
  const state = await db.getFullState();
  const teams = state.teams, matches = tournament.applyLeagueTiming(state.matches);
  const groupMatches = matches.filter(m => m.phase === 'group');
  const rules = await db.getScoringRules();
  const mode = currentMode(teams, groupMatches);
  const standings = { A: tournament.calculateStandings(teams, groupMatches, 'league') };
  const groupNames = ['A'];
  const placementMatches = matches.filter(m => m.phase === 'placement');
  const placementIds = new Set(placementMatches.flatMap(m => [m.team1_id, m.team2_id]));
  const placementStandings = tournament.calculateStandings(teams.filter(t => placementIds.has(t.id)), placementMatches, 'league');
  return { teams, matches, standings, placementStandings, mode, groupNames, rules };
}

// ── Bracket Advancement ───────────────────────────────────────────────────────
async function tryAdvanceBracket(attempt = 0) {
  if(attempt>3)throw new Error('The tournament is changing. Retry bracket creation.');
  const state = await db.getFullState();
  const { teams, matches } = state;
  const league = matches.filter(m => m.phase === 'group');
  const semis = matches.filter(m => m.phase === 'gold_sf');
  if (league.length && league.every(m => m.status === 'done') && semis.length === 0) {
    const seeds = tournament.calculateStandings(teams, league, 'league').map(row => row.team.id);
    if (![6, 7].includes(seeds.length)) return;
    const next = [
      ['gold_sf', 1, seeds[0], seeds[3], 'Semifinal 1', { referee_team_id: seeds[1] }],
      ['gold_sf', 1, seeds[1], seeds[2], 'Semifinal 2'],
    ];
    const bottom = seeds.slice(4);
    for (const [i, pair] of tournament.generateRoundRobin(bottom).entries()) {
      next.push(['placement', 2, ...pair, 'Placement game ' + (i + 1),
        { referee_team_id: bottom.find(id => !pair.includes(id)) ?? seeds[2] }]);
    }
    if(await db.insertBracketMatches(next,state)===false)return tryAdvanceBracket(attempt+1);
    return;
  }
  if (semis.length !== 2) return;
  const [first, second] = semis;
  if (first.status === 'done' && second.status === 'pending' && second.sets.length === 0) {
    const winner = tournament.getMatchWinner(first.sets, first);
    if (winner && await db.updateMatchReferee(second.id, winner === 1 ? first.team2_id : first.team1_id,state)===false)return tryAdvanceBracket(attempt+1);
  }
  if (semis.every(m => m.status === 'done') && !matches.some(m => m.phase === 'gold_final')) {
    const winners = semis.map(m => tournament.getMatchWinner(m.sets, m));
    if (winners.every(Boolean)) {
      if(await db.insertBracketMatches([['gold_final', 1,
        winners[0] === 1 ? first.team1_id : first.team2_id,
        winners[1] === 1 ? second.team1_id : second.team2_id, 'Gold Final 🥇',
        { referee_team_id: winners[1] === 1 ? second.team2_id : second.team1_id }]],state)===false)return tryAdvanceBracket(attempt+1);
    }
  }
}

// ── Team Setup ────────────────────────────────────────────────────────────────
const rosterVersion = teams => createHash('sha256').update(JSON.stringify([...teams].sort((a,b)=>a.id-b.id).map(t=>[t.id,t.name]))).digest('hex');
const setupOpen = matches => matches.every(m => m.status === 'pending' && m.sets.length === 0);
async function renderSetup(res, error = null) {
  const { teams, matches } = await db.getFullState();
  res.render('admin/setup', { teams, canSetup: setupOpen(matches), rosterVersion: rosterVersion(teams), error, hasSchedule: matches.length > 0 });
}
get('/admin/setup', requireAdmin, async (req, res) => renderSetup(res));
post('/admin/setup', requireAdmin, async (req, res) => {
  const { teams, matches } = await db.getFullState();
  if (!setupOpen(matches)) return renderSetup(res.status(409), 'Team and schedule changes are locked once play has started.');
  if (req.body.rosterVersion !== rosterVersion(teams)) return renderSetup(res.status(409), 'The roster changed. Reload this page before saving.');
  if (req.body.confirmReset !== 'yes') return renderSetup(res.status(409), 'Confirm replacement of the schedule and referee assignments.');
  const ids = [].concat(req.body.teamId || []), names = [].concat(req.body.name || []);
  const desired = names.map((name,i) => ({ id: ids[i] ? Number(ids[i]) : -(i+1), name: typeof name === 'string' ? name.trim() : '' }));
  if (![6,7].includes(desired.length) || names.length !== ids.length || desired.some(t => !t.name || t.name.length > 100 || !Number.isSafeInteger(t.id)
    || (ids[desired.indexOf(t)] && t.id <= 0) || (t.id > 0 && !teams.some(old => old.id === t.id))) || new Set(desired.map(t=>t.id)).size !== desired.length
    || new Set(desired.map(t=>t.name)).size !== desired.length) return renderSetup(res.status(400), 'Enter six or seven teams with unique names.');
  const shuffled = [...desired];
  for (let i=shuffled.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  const namedMatches = tournament.generateLeagueSchedule(shuffled.map(t=>t.id)).map(m => ({ ...m,
    team1_name: desired.find(t=>t.id===m.team1_id).name, team2_name: desired.find(t=>t.id===m.team2_id).name,
    referee_name: desired.find(t=>t.id===m.referee_team_id).name }));
  if (!await db.saveTeamSetup(teams, desired, namedMatches)) return renderSetup(res.status(409), 'The roster changed or a result was saved. Reload before continuing.');
  res.redirect('/admin');
});

post('/admin/team/:id/icon', requireAdmin, upload.single('icon'), async (req, res) => {
  if (!req.file) return res.redirect('/admin/setup');
  const teamId = Number(req.params.id);
  const team = (await db.getTeams()).find(team => team.id === teamId);
  if (!team) return res.status(404).send('Team not found');
  if (!validImage(req.file)) return res.status(400).send('Upload a PNG, JPEG, GIF, or WebP image.');
  const url = await icons.save(teamId, req.file);
  await db.updateTeamIcon(teamId, url);
  res.redirect('/admin/setup');
});

// ── Admin Dashboard ───────────────────────────────────────────────────────────
async function renderAdmin(res, error = null) {
  const { teams, matches, standings, placementStandings, mode, groupNames, rules } = await buildState();
  const groupMatches = matches.filter(m => m.phase === 'group');
  const bracketMatches = matches.filter(m => m.phase !== 'group');
  const allGroupDone = groupMatches.length > 0 && groupMatches.every(m => m.status === 'done');
  res.render('admin/index', {
    teams, groupMatches, bracketMatches, standings, placementStandings, allGroupDone, mode, groupNames, rules,
    canSetup: setupOpen(matches), canWithdraw: teams.length === 7 && setupOpen(matches), error,
  });
}

get('/admin', requireAdmin, async (req, res) => renderAdmin(res, req.query.advanceError ? 'Result saved. Bracket creation failed; use Retry bracket creation below.' : null));

post('/admin/match-rules', requireAdmin, async (req, res) => {
  res.status(410).send('Tournament rules are fixed: league 2 × 10 minutes; playoffs and placement best of three at 25/25/15, win by two.');
});

// ── Print ─────────────────────────────────────────────────────────────────────
get('/admin/print', requireAdmin, async (req, res) => {
  const { matches, standings, placementStandings, mode, groupNames } = await buildState();
  const groupMatches = matches.filter(m => m.phase === 'group');
  const bracketMatches = matches.filter(m => m.phase !== 'group');
  const allGroupDone = groupMatches.length > 0 && matches.filter(m => m.phase === 'group').every(m => m.status === 'done');
  res.render('admin/print', { standings, placementStandings, groupMatches, bracketMatches, mode, groupNames, allGroupDone });
});

// ── Schedule Generation ───────────────────────────────────────────────────────
post('/admin/generate-schedule', requireAdmin, async (req, res) => {
  const { teams, matches } = await db.getFullState();
  if (req.body.mode !== undefined && req.body.mode !== 'league') {
    return renderAdmin(res.status(400), 'This tournament uses the fixed league format.');
  }
  if (![6, 7].includes(teams.length)) {
    return renderAdmin(res.status(400), 'This tournament requires seven teams, or six after a withdrawal.');
  }
  if (matches.length && req.body.confirmReset !== 'yes') {
    return renderAdmin(res.status(409), 'Regenerating resets the schedule. Tick the confirmation checkbox to continue.');
  }
  if (matches.some(m => m.status !== 'pending' || m.sets.length)) {
    return renderAdmin(res.status(409), 'The schedule is locked once play has started.');
  }
  const shuffled = [...teams];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const saved = await db.regenerateSchedule(shuffled.map(team => ({ ...team, group_name: 'A' })),
    tournament.generateLeagueSchedule(shuffled.map(team => team.id)));
  if (!saved) return renderAdmin(res.status(409), 'The tournament has changed or play has started. Refresh Admin.');
  res.redirect('/admin');
});

post('/admin/withdraw-team', requireAdmin, async (req, res) => {
  const { teams, matches } = await db.getFullState();
  if (teams.length !== 7 || matches.some(m => m.status !== 'pending' || m.sets.length)) {
    return renderAdmin(res.status(409), 'The six-team fallback is available only before play starts, with seven teams.');
  }
  const teamId = Number(req.body.teamId);
  if (!Number.isInteger(teamId) || !teams.some(team => team.id === teamId)) {
    return renderAdmin(res.status(400), 'Select the team that is missing.');
  }
  if (req.body.confirmReset !== 'yes') {
    return renderAdmin(res.status(409), 'Confirm the withdrawal and replacement of the schedule before continuing.');
  }
  const remaining = teams.filter(team => team.id !== teamId);
  if (!await db.withdrawTeam(teamId, remaining, tournament.generateLeagueSchedule(remaining.map(team => team.id)))) {
    return renderAdmin(res.status(409), 'The tournament has changed or play has started. Refresh Admin.');
  }
  res.redirect('/admin');
});

async function earlierCourtMatch(match) {
  if (match.phase === 'group' || match.status === 'done') return false;
  const state = await db.getFullState();
  return state.matches.some(other => other.phase !== 'group' && other.court === match.court
    && other.id < match.id && other.status !== 'done');
}

async function activeConflict(match) {
  const participants = game => [game.team1_id, game.team2_id, game.referee_team_id].filter(id => id != null);
  return (await db.getFullState()).matches.find(other => other.id !== match.id && other.status === 'active'
    && (other.court === match.court || participants(other).some(id => participants(match).includes(id))));
}

// ── Score Entry ───────────────────────────────────────────────────────────────
const scoreVersion = match => createHash('sha256').update(JSON.stringify([match.id,match.team1_id,match.team2_id,match.status,match.sets.map(s=>[s.set_number,s.team1_score,s.team2_score])])).digest('hex');
async function scoreMatch(id) {
  return tournament.applyLeagueTiming((await db.getFullState()).matches).find(match => match.id === id);
}
get('/admin/match/:id/score', requireAdmin, async (req, res) => {
  const match = await scoreMatch(Number(req.params.id));
  if (!match) return res.status(404).send('Match not found');
  if (await earlierCourtMatch(match)) return renderAdmin(res.status(409), 'Finish the earlier match on this court first.');
  res.render('admin/match', { match, error: null, locked: false, scoreVersion:scoreVersion(match) });
});

post('/admin/match/:id/score', requireAdmin, async (req, res) => {
  const match = await scoreMatch(Number(req.params.id));
  if (!match) return res.status(404).send('Match not found');
  if(req.body.scoreVersion!==undefined&&req.body.scoreVersion!==scoreVersion(match))return renderAdmin(res.status(409),'This score form is out of date: the teams or result changed. Reopen the game before saving.');
  if (await earlierCourtMatch(match)) return renderAdmin(res.status(409), 'Finish the earlier match on this court first.');
  if (match.status !== 'done' && await activeConflict(match)) return renderAdmin(res.status(409), 'This court, a team or its referee team is still involved in another active match.');
  const entered = [1,2,3].map(n=>({n,t1:req.body['s'+n+'t1'],t2:req.body['s'+n+'t2']})).filter(s=>[s.t1,s.t2].some(v=>v!=null&&v!==''));
  const valid = value => typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value)<=9999;
  const fail = message => res.status(400).render('admin/match', { error:message, scoreVersion:scoreVersion(match), match:{...match,sets:entered.map(s=>({set_number:s.n,team1_score:typeof s.t1==='string'?s.t1:'',team2_score:typeof s.t2==='string'?s.t2:''}))} });
  if (!entered.length || entered.some((s,i)=>s.n!==i+1 || !valid(s.t1) || !valid(s.t2))) return fail('Enter whole-number scores from 0 to 9999 for both teams, starting with set 1.');
  const scores = entered.map(s=>({n:s.n,t1:Number(s.t1),t2:Number(s.t2)}));
  const setScores = scores.map(s=>({team1_score:s.t1,team2_score:s.t2}));
  if (match.scoring_format === 'timed') {
    const periods = match.timed_periods || 1;
    if (scores.length !== periods || (periods===2 && scores.some(s=>s.t1===s.t2))) return fail('Enter both timed set results. A tied set needs one deciding rally; a 1–1 match draw is allowed.');
  } else {
    const winner = match.fixed_sets===2 ? tournament.getFixedSetWinner(setScores,match) : tournament.getMatchWinner(setScores,match);
    const validTerminalScores = setScores.every((set,i) => { const target=i===2?match.deciding_set_target:match.set_target; const high=Math.max(set.team1_score,set.team2_score),margin=Math.abs(set.team1_score-set.team2_score); return (high===target&&margin>=2)||(high>target&&margin===2); });
    const alreadyFinished = match.fixed_sets!==2 && setScores.length>1 && tournament.getMatchWinner(setScores.slice(0,-1),match)!==null;
    if (winner===null || !validTerminalScores || alreadyFinished || (match.fixed_sets===2 && scores.length!==2)) return fail('Enter a complete match result: two set wins, first two sets to '+match.set_target+', deciding third set to '+match.deciding_set_target+', win by two. Leave set 3 blank after 2–0.');
  }
  if(match.status==='done'){
    const result=await db.correctScore(match.id,scores,match);
    if(!result.ok)return res.status(409).render('admin/match',{match:{...match,sets:entered.map(s=>({set_number:s.n,team1_score:s.t1,team2_score:s.t2}))},error:result.error||'The tournament changed. Reload Admin before correcting this result.',locked:false,scoreVersion:scoreVersion(match)});
  }else if (!await db.saveScore(match.id,scores,'done',match)) return renderAdmin(res.status(409),'This result is locked or the schedule changed. Reload Admin.');
  try { await tryAdvanceBracket(); }
  catch (error) { console.error(error); return res.redirect('/admin?advanceError=1'); }
  res.redirect('/admin');
});

post('/admin/advance-bracket', requireAdmin, async (req, res) => {
  await tryAdvanceBracket();
  res.redirect('/admin');
});

// ── API ───────────────────────────────────────────────────────────────────────
get('/api/state', async (req, res) => {
  const { teams, matches, standings, placementStandings, mode, groupNames, rules } = await buildState();
  res.json({ teams, matches, standings, placementStandings, mode, groupNames, rules });
});

// ── Public Pages ─────────────────────────────────────────────────────────────
get('/', async (req, res) => {
  const { teams, matches, standings, placementStandings, mode, groupNames, rules } = await buildState();
  res.render('index', { teams, matches, standings, placementStandings, mode, groupNames, rules });
});


get('/qr', async (req, res) => {
  const publicUrl = baseUrl || (req.protocol + '://' + req.get('host'));
  const svg = renderQR.render(QRCode.create(publicUrl), { width: 280, margin: 2 });
  const qrDataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  res.render('qr', { qrDataUrl, baseUrl: publicUrl });
});

// ── Health ────────────────────────────────────────────────────────────────────
get('/health', async (req, res) => res.send('ok'));


app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) return res.status(400).send('Choose one image of 5 MiB or less.');
  console.error(error);
  res.status(500).send('The change could not be saved. Please refresh and try again.');
});
return app;
};
