require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const tournament = require('./tournament');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
if (!process.env.ADMIN_PIN) {
  console.warn('[WARNING] ADMIN_PIN env var not set — using default PIN "1234". Set ADMIN_PIN in .env for production.');
}
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const uploadsDir = path.join(__dirname, 'public', 'uploads', 'teams');
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `team-${req.params.id}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// ── Auth ─────────────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.cookies.admin === ADMIN_PIN) return next();
  res.redirect('/admin/login');
}

app.get('/admin/login', (req, res) => {
  res.render('login', {});
});

app.post('/admin/login', (req, res) => {
  if (req.body.pin === ADMIN_PIN) {
    res.cookie('admin', ADMIN_PIN, { httpOnly: true, sameSite: 'strict' });
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Wrong PIN' });
  }
});

app.get('/admin/logout', (req, res) => {
  res.clearCookie('admin');
  res.redirect('/');
});

// ── Helper: build state ───────────────────────────────────────────────────────
function buildState() {
  const { teams, matches } = db.getFullState();
  const teamsByGroup = {
    A: teams.filter(t => t.group_name === 'A'),
    B: teams.filter(t => t.group_name === 'B'),
  };
  const groupAIds = new Set(teamsByGroup.A.map(t => t.id));
  const groupBIds = new Set(teamsByGroup.B.map(t => t.id));
  const groupMatches = matches.filter(m => m.phase === 'group');
  const doneGroupA = groupMatches.filter(m => m.status === 'done' && groupAIds.has(m.team1_id));
  const doneGroupB = groupMatches.filter(m => m.status === 'done' && groupBIds.has(m.team1_id));
  const standings = {
    A: tournament.calculateStandings(teamsByGroup.A, doneGroupA),
    B: tournament.calculateStandings(teamsByGroup.B, doneGroupB),
  };
  return { teams, matches, standings, teamsByGroup };
}

// ── Bracket Advancement ───────────────────────────────────────────────────────
function tryAdvanceBracket() {
  const { teams, matches } = db.getFullState();
  const teamsByGroup = {
    A: teams.filter(t => t.group_name === 'A'),
    B: teams.filter(t => t.group_name === 'B'),
  };
  const groupAIds = new Set(teamsByGroup.A.map(t => t.id));
  const groupBIds = new Set(teamsByGroup.B.map(t => t.id));

  const groupMatches = matches.filter(m => m.phase === 'group');
  const goldSFs      = matches.filter(m => m.phase === 'gold_sf');
  const silverSFs    = matches.filter(m => m.phase === 'silver_sf');
  const goldFinals   = matches.filter(m => m.phase === 'gold_final');
  const silverFinals = matches.filter(m => m.phase === 'silver_final');

  if (groupMatches.length > 0 && groupMatches.every(m => m.status === 'done') && goldSFs.length === 0) {
    const doneA = groupMatches.filter(m => groupAIds.has(m.team1_id));
    const doneB = groupMatches.filter(m => groupBIds.has(m.team1_id));
    const sA = tournament.calculateStandings(teamsByGroup.A, doneA);
    const sB = tournament.calculateStandings(teamsByGroup.B, doneB);

    db.insertMatch('gold_sf',   1, sA[0].team.id, sB[1].team.id, 'Gold SF 1');
    db.insertMatch('gold_sf',   2, sB[0].team.id, sA[1].team.id, 'Gold SF 2');

    const a3 = sA[2], b3 = sB[2], a4 = sA[3], b4 = sB[3];
    if (a3 && b3) {
      if (a4 && b4) {
        db.insertMatch('silver_sf', 1, a3.team.id, b4.team.id, 'Silver SF 1');
        db.insertMatch('silver_sf', 2, b3.team.id, a4.team.id, 'Silver SF 2');
      } else {
        db.insertMatch('silver_sf', 1, a3.team.id, b3.team.id, 'Silver Final 🥈');
      }
    }
    return;
  }

  if (goldSFs.length === 2 && goldSFs.every(m => m.status === 'done') && goldFinals.length === 0) {
    const w1 = tournament.getMatchWinner(goldSFs[0].sets);
    const w2 = tournament.getMatchWinner(goldSFs[1].sets);
    if (w1 && w2) {
      const t1 = w1 === 1 ? goldSFs[0].team1_id : goldSFs[0].team2_id;
      const t2 = w2 === 1 ? goldSFs[1].team1_id : goldSFs[1].team2_id;
      db.insertMatch('gold_final', 1, t1, t2, 'Gold Final 🥇');
    }
  }

  if (silverSFs.length === 2 && silverSFs.every(m => m.status === 'done') && silverFinals.length === 0) {
    const w1 = tournament.getMatchWinner(silverSFs[0].sets);
    const w2 = tournament.getMatchWinner(silverSFs[1].sets);
    if (w1 && w2) {
      const t1 = w1 === 1 ? silverSFs[0].team1_id : silverSFs[0].team2_id;
      const t2 = w2 === 1 ? silverSFs[1].team1_id : silverSFs[1].team2_id;
      db.insertMatch('silver_final', 1, t1, t2, 'Silver Final 🥈');
    }
  }
}

// ── Team Setup ────────────────────────────────────────────────────────────────
app.get('/admin/setup', requireAdmin, (req, res) => {
  const teams = db.getTeams();
  const message = req.query.saved ? `${teams.length} teams saved.` : null;
  res.render('admin/setup', { teams, message });
});

app.post('/admin/setup', requireAdmin, (req, res) => {
  const names  = [].concat(req.body.name  || []);
  const groups = [].concat(req.body.group || []);
  const validTeams = names
    .map((name, i) => ({ name: name.trim(), group: groups[i] }))
    .filter(t => t.name.length > 0);
  try {
    for (const f of fs.readdirSync(uploadsDir)) fs.unlinkSync(path.join(uploadsDir, f));
  } catch (e) {}
  db.clearAll();
  for (const t of validTeams) db.insertTeam(t.name, t.group);
  res.redirect('/admin/setup?saved=1');
});

app.post('/admin/team/:id/icon', requireAdmin, upload.single('icon'), (req, res) => {
  if (!req.file) return res.redirect('/admin');
  const teamId = Number(req.params.id);
  const team = db.getTeams().find(t => t.id === teamId);
  if (team && team.icon_path) {
    try { fs.unlinkSync(path.join(__dirname, 'public', team.icon_path)); } catch (e) {}
  }
  db.updateTeamIcon(teamId, `/uploads/teams/${req.file.filename}`);
  res.redirect('/admin');
});

// ── Admin Dashboard ───────────────────────────────────────────────────────────
app.get('/admin', requireAdmin, (req, res) => {
  const { teams, matches, standings } = buildState();
  const groupMatches  = matches.filter(m => m.phase === 'group');
  const bracketMatches = matches.filter(m => m.phase !== 'group');
  const allGroupDone  = groupMatches.length > 0 && groupMatches.every(m => m.status === 'done');
  res.render('admin/index', { teams, groupMatches, bracketMatches, standings, allGroupDone });
});

// ── Print ─────────────────────────────────────────────────────────────────────
app.get('/admin/print', requireAdmin, (req, res) => {
  const { matches, standings } = buildState();
  const bracketMatches = matches.filter(m => m.phase !== 'group');
  res.render('admin/print', { standings, bracketMatches });
});

// ── Schedule Generation ───────────────────────────────────────────────────────
app.post('/admin/generate-schedule', requireAdmin, (req, res) => {
  const teams  = db.getTeams();
  const groupA = teams.filter(t => t.group_name === 'A');
  const groupB = teams.filter(t => t.group_name === 'B');
  db.clearMatches();
  let court = 1;
  for (const [t1, t2] of tournament.generateRoundRobin(groupA.map(t => t.id))) {
    db.insertMatch('group', court, t1, t2, null);
    court = court === 2 ? 1 : 2;
  }
  for (const [t1, t2] of tournament.generateRoundRobin(groupB.map(t => t.id))) {
    db.insertMatch('group', court, t1, t2, null);
    court = court === 2 ? 1 : 2;
  }
  res.redirect('/admin');
});

// ── Score Entry ───────────────────────────────────────────────────────────────
app.get('/admin/match/:id/score', requireAdmin, (req, res) => {
  const match = db.getMatchWithSets(Number(req.params.id));
  if (!match) return res.status(404).send('Match not found');
  if (match.status === 'pending') db.updateMatchStatus(match.id, 'active');
  res.render('admin/match', { match: db.getMatchWithSets(match.id) });
});

app.post('/admin/match/:id/score', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const match = db.getMatchWithSets(matchId);
  if (!match) return res.status(404).send('Match not found');

  const rawSets = [
    { n: 1, t1: req.body.s1t1, t2: req.body.s1t2 },
    { n: 2, t1: req.body.s2t1, t2: req.body.s2t2 },
    { n: 3, t1: req.body.s3t1, t2: req.body.s3t2 },
  ];
  const validSets = rawSets
    .filter(s => s.t1 !== '' && s.t2 !== '' && s.t1 != null && s.t2 != null)
    .map(s => ({ n: s.n, t1: parseInt(s.t1) || 0, t2: parseInt(s.t2) || 0 }));

  db.deleteSetsForMatch(matchId);
  for (const s of validSets) db.upsertSet(matchId, s.n, s.t1, s.t2);

  const winner = tournament.getMatchWinner(validSets.map(s => ({ team1_score: s.t1, team2_score: s.t2 })));
  db.updateMatchStatus(matchId, winner ? 'done' : 'active');
  if (winner) tryAdvanceBracket();

  res.redirect('/admin');
});

app.post('/admin/advance-bracket', requireAdmin, (req, res) => {
  tryAdvanceBracket();
  res.redirect('/admin');
});

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  const { teams, matches, standings } = buildState();
  res.json({ teams, matches, standings });
});

// ── Public Pages ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const { teams, matches, standings } = buildState();
  res.render('index', { teams, matches, standings });
});

app.get('/tv', (req, res) => {
  const { teams, matches, standings } = buildState();
  res.render('tv', { teams, matches, standings });
});

app.get('/qr', async (req, res) => {
  const qrDataUrl = await QRCode.toDataURL(BASE_URL, { width: 280, margin: 2 });
  res.render('qr', { qrDataUrl, baseUrl: BASE_URL });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.send('ok'));

app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
