import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createDatabase} from './cloudflare/database.mjs';
test('custom-domain gateway preserves scores, login, QR destination and static assets',async t=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[
  {name:'gateway',modules:true,scriptPath:'cloudflare/domain-gateway/_worker.js',compatibilityDate:'2026-09-18',serviceBindings:{TOURNAMENT:'tournament',ASSETS:async request=>{const url=new URL(request.url);return new Response(await fs.readFile('public'+url.pathname),{headers:{'Content-Type':url.pathname.endsWith('.css')?'text/css':'text/javascript'}});}}},
  {name:'tournament',modules:true,scriptPath:'dist/worker.mjs',compatibilityDate:'2026-09-18',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'gateway-test'},bindings:{ADMIN_PIN:'gateway-test'}}
 ]}));t.after(()=>mf.dispose());await mf.ready;
 const database=await mf.getD1Database('DB','tournament');
 for(const file of(await fs.readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){const sql=await fs.readFile('migrations/'+file,'utf8');await database.batch(sql.split(';').filter(s=>s.trim()).map(s=>database.prepare(s)));}
 await createDatabase(database).replaceTeams(Array.from({length:7},(_,i)=>({name:'Gateway team '+i})),'league');
 const base='https://volleyball.florian-zug.de';let cookie='';const req=(route,fields)=>mf.dispatchFetch(base+route,{method:fields?'POST':'GET',redirect:'manual',headers:cookie?{Cookie:cookie}:{},body:fields?new URLSearchParams(fields):undefined});
 assert.equal((await req('/admin')).status,302);const login=await req('/admin/login',{pin:'gateway-test'});assert.equal(login.status,302);cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/Secure/);
 assert.equal((await req('/admin/generate-schedule',{})).status,302);let s=await(await req('/api/state')).json();assert.equal(s.matches.length,21);
 assert.match(await(await req('/qr')).text(),/href="https:\/\/volleyball\.florian-zug\.de"/);
 const m=s.matches[0];assert.equal((await req('/admin/match/'+m.id+'/score',{s1t1:'20',s1t2:'18',s2t1:'18',s2t2:'20'})).status,302);s=await(await req('/api/state')).json();assert.equal(s.matches[0].status,'done');assert.equal(s.matches[0].sets.length,2);
 assert.match(await(await req('/admin')).text(),/Awaiting results/);
 for(const path of ['/style.css','/client.js']){const response=await req(path);assert.equal(response.status,200);assert.equal(await response.text(),await fs.readFile('public'+path,'utf8'));}
});
