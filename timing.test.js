const {test}=require('node:test');
const {once}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tournament-timing-'));
process.env.DB_PATH=path.join(directory,'test.db');
const db=require('./db');

test('SQLite adapts the league timetable after saving results',async t=>{
  const app=require('./app')({db,icons:{},adminPin:'timing-test'});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const raw=new (require('better-sqlite3'))(process.env.DB_PATH);
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));raw.close();fs.rmSync(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const req=(path,fields)=>fetch(base+path,{method:fields?'POST':'GET',redirect:'manual',headers:{Cookie:'admin=timing-test',...(fields?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:fields?new URLSearchParams(fields):undefined});
  await require('./test-support/timing-scenarios.cjs')(t,{db,req,state:async()=>(await req('/api/state')).json(),sql:async sql=>raw.exec(sql)});
});
