import {test} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createDatabase} from './cloudflare/database.mjs';
import scenarios from './test-support/timing-scenarios.cjs';

test('Cloudflare D1 adapts the league timetable after saving results',async t=>{
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker.mjs',compatibilityDate:'2026-09-18',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'timing-test'},bindings:{ADMIN_PIN:'timing-test'}}));
  t.after(()=>mf.dispose());await mf.ready;
  const database=await mf.getD1Database('DB');
  for(const file of(await fs.readdir('migrations')).filter(file=>file.endsWith('.sql')).sort()){
    const sql=await fs.readFile(path.join('migrations',file),'utf8');
    await database.batch(sql.split(';').filter(statement=>statement.trim()).map(statement=>database.prepare(statement)));
  }
  let cookie='';
  const req=(path,fields)=>mf.dispatchFetch('http://localhost'+path,{method:fields?'POST':'GET',redirect:'manual',headers:cookie?{Cookie:cookie}:{},body:fields?new URLSearchParams(fields):undefined});
  const login=await req('/admin/login',{pin:'timing-test'});cookie=login.headers.get('set-cookie').split(';')[0];
  await scenarios(t,{db:createDatabase(database),req,state:async()=>(await req('/api/state')).json(),sql:sql=>database.prepare(sql).run()});
});
