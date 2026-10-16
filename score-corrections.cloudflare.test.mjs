import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createDatabase} from './cloudflare/database.mjs';
import scenarios from './test-support/correction-scenarios.cjs';
test('Cloudflare corrects results and their pending brackets atomically',async t=>{
 const root=path.resolve('.superpowers'),storage=await fs.mkdtemp(path.join(root,'correction-d1-'));
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker.mjs',compatibilityDate:'2026-09-18',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'correction-tests'},resourcePersistencePath:storage,bindings:{ADMIN_PIN:'correction-test'}}));
 t.after(async()=>{await mf.dispose();assert.equal(path.dirname(storage),root);await fs.rm(storage,{recursive:true,force:true});});await mf.ready;
 const database=await mf.getD1Database('DB');
 for(const file of(await fs.readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){const sql=await fs.readFile(path.join('migrations',file),'utf8');await database.batch(sql.split(';').filter(s=>s.trim()).map(s=>database.prepare(s)));}
 let cookie='';const req=(route,fields)=>mf.dispatchFetch('http://localhost'+route,{method:fields?'POST':'GET',redirect:'manual',headers:cookie?{Cookie:cookie}:{},body:fields?new URLSearchParams(fields):undefined});
 const login=await req('/admin/login',{pin:'correction-test'});cookie=login.headers.get('set-cookie').split(';')[0];
 await scenarios(t,{db:createDatabase(database),req,state:async()=>(await req('/api/state')).json(),sql:sql=>database.prepare(sql).run()});
});
