import {test} from 'node:test';
import fs from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createDatabase} from './cloudflare/database.mjs';
import scenarios from './test-support/score-progress-scenarios.cjs';
test('single-set scoring persists and publishes updates safely in Cloudflare D1',async t=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker.mjs',compatibilityDate:'2026-09-18',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'progress-test'},bindings:{ADMIN_PIN:'progress-test'}}));t.after(()=>mf.dispose());await mf.ready;const database=await mf.getD1Database('DB');for(const file of(await fs.readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){const sql=await fs.readFile('migrations/'+file,'utf8');await database.batch(sql.split(';').filter(s=>s.trim()).map(s=>database.prepare(s)));}let cookie='';const req=(route,fields)=>mf.dispatchFetch('http://localhost'+route,{method:fields?'POST':'GET',redirect:'manual',headers:cookie?{Cookie:cookie}:{},body:fields?new URLSearchParams(fields):undefined});const login=await req('/admin/login',{pin:'progress-test'});cookie=login.headers.get('set-cookie').split(';')[0];await scenarios(t,{db:createDatabase(database),req,state:async()=>(await req('/api/state')).json()});
});
