const {test}=require('node:test');
const {once}=require('node:events');
const fs=require('node:fs'),path=require('node:path');
fs.mkdirSync(path.join(__dirname,'.superpowers'),{recursive:true});
const root=fs.mkdtempSync(path.join(__dirname,'.superpowers','swap-test-'));
process.env.DB_PATH=path.join(root,'test.db');
const db=require('./db'),createApp=require('./app'),Database=require('better-sqlite3');
test('upcoming match swaps are safe and persistent in SQLite',async t=>{
  const server=createApp({db,icons:{},adminPin:'swap-test'}).listen(0,'127.0.0.1');await once(server,'listening');
  const raw=new Database(process.env.DB_PATH);
  t.after(async()=>{await new Promise(r=>server.close(r));raw.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const req=(route,fields)=>fetch(base+route,{method:fields?'POST':'GET',redirect:'manual',headers:{Cookie:'admin=swap-test',...(fields?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:fields?new URLSearchParams(fields):undefined});
  await require('./test-support/swap-scenarios.cjs')(t,{db,req,state:async()=>(await req('/api/state')).json(),sql:async sql=>raw.exec(sql)});
});
