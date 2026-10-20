import fs from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import { build } from 'esbuild';

await fs.mkdir('dist/public', { recursive: true });
const publicAssets = ['style.css', 'client.js'];
const unexpected = (await fs.readdir('dist/public')).filter(file => !publicAssets.includes(file));
if (unexpected.length) throw new Error('Unexpected deployment assets in dist/public: ' + unexpected.join(', '));
async function templates(dir = 'views') {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await templates(file));
    else if (entry.name.endsWith('.ejs')) found.push(file);
  }
  return found;
}
const viewLocals = {
  _final_standings:['finished'], _team:['team','size','vertical'], _court:['m','admin','allMatches'], _standings:['rows','caption','offset','placement'],
  _header: ['title', 'refresh', 'bodyClass', 'hideNav', 'scoresVersion', 'scoreSaved'], _footer: [], _match_row: ['m','admin','allMatches'], _score: ['m'], _referee: ['m'], _placement_standings: ['placementStandings'],
  _current_standings: ['leagueRows','placementRows'],
  index: ['rules', 'mode', 'teams', 'matches', 'standings', 'placementStandings', 'groupNames', 'scoresVersion'],
  login: ['error'], qr: ['qrDataUrl', 'baseUrl'],
  'admin/index': ['rules', 'teams', 'groupMatches', 'bracketMatches', 'standings', 'placementStandings', 'allGroupDone', 'mode', 'groupNames', 'canWithdraw', 'canSetup', 'error', 'scoreSaved', 'scheduleVersion'],
  'admin/_schedule_form': ['teams', 'groupMatches', 'mode'],
  'admin/setup': ['teams', 'canSetup', 'rosterVersion', 'error', 'hasSchedule'], 'admin/match': ['match', 'error', 'locked', 'scoreVersion'],
  'admin/print': ['standings', 'placementStandings', 'groupMatches', 'bracketMatches', 'mode', 'groupNames', 'allGroupDone'],
};
const compiled = [];
for (const file of await templates()) {
  const name = path.relative('views', file).replaceAll('\\', '/').replace(/\.ejs$/, '');
  const fn = ejs.compile(await fs.readFile(file, 'utf8'), { client: true, compileDebug: false, strict: true, _with: false, destructuredLocals: [...(viewLocals[name] || []), 'ui'], filename: name });
  compiled.push(`${JSON.stringify(name)}: ${fn.toString()}`);
}
await fs.writeFile('dist/templates.mjs', `import path from 'node:path';
const templates = {${compiled.join(',\n')}};
export function render(name, locals = {}) {
  const template = templates[name];
  if (!template) throw new Error('Unknown view: ' + name);
  return template(locals, undefined, (include, data = {}) => {
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(name), include)).replace(/\\.ejs$/, '');
    return render(relative, { ...locals, ...data });
  });
}
`);
// Explicit allowlist: never publish local uploads, databases or .env files.
for (const file of publicAssets) await fs.copyFile('public/' + file, 'dist/public/' + file);
await build({
  entryPoints: ['cloudflare/worker.mjs'], outfile: 'dist/worker.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'es2022',
  external: ['cloudflare:*', 'node:*'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire('/worker.js');" },
  minify: true,
});
console.log('Built Cloudflare Worker and public assets.');
