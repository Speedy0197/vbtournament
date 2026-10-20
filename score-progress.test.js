const {test}=require('node:test'),{once}=require('node:events');
process.env.DB_PATH=':memory:';
const db=require('./db'),createApp=require('./app'),scenarios=require('./test-support/score-progress-scenarios.cjs');
test('single-set scoring persists and publishes updates safely in SQLite',async t=>{
 const server=createApp({db,icons:{clear:async()=>{}},adminPin:'progress-test'}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
 const req=(route,fields)=>fetch(base+route,{method:fields?'POST':'GET',redirect:'manual',headers:{Cookie:'admin=progress-test',...(fields?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(fields?{body:new URLSearchParams(fields)}:{})});await scenarios(t,{db,req,state:async()=>(await req('/api/state')).json()});
});
