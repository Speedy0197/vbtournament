const {test}=require('node:test');const {once}=require('node:events');const createApp=require('./app'),Database=require('better-sqlite3');
// A file database permits a second connection for rollback triggers.
const fs=require('node:fs'),path=require('node:path');
const root=fs.mkdtempSync(path.join(__dirname,'.superpowers','correction-test-'));
process.env.DB_PATH=path.join(root,'test.db');const adapter=require('./db');
test('score corrections preserve played games and update pending dependencies atomically',async t=>{
 const app=createApp({db:adapter,icons:{clear:async()=>{}},adminPin:'correction-test'}),server=app.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(r=>server.close(r));});
 const raw=new Database(process.env.DB_PATH);t.after(()=>raw.close());
 const base='http://127.0.0.1:'+server.address().port;
 const req=(route,fields)=>fetch(base+route,{method:fields?'POST':'GET',redirect:'manual',headers:{Cookie:'admin=correction-test',...(fields?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:fields?new URLSearchParams(fields):undefined});
 await require('./test-support/correction-scenarios.cjs')(t,{db:adapter,req,state:async()=>(await req('/api/state')).json(),sql:async sql=>raw.exec(sql)});
 await t.test('two overlapping advancement requests cannot seed an old semifinal winner',async()=>{
  const semis=adapter.getFullState().matches.filter(m=>m.phase==='gold_sf');
  for(const m of semis)adapter.saveScore(m.id,[{n:1,t1:25,t2:20},{n:2,t1:25,t2:20}],'done');
  const original=adapter.insertBracketMatches;let count=0,releaseOld,releaseNew,oldArrived,newArrived;
  const oldGate=new Promise(r=>releaseOld=r),newGate=new Promise(r=>releaseNew=r),oldReady=new Promise(r=>oldArrived=r),newReady=new Promise(r=>newArrived=r);
  adapter.insertBracketMatches=async(...args)=>{if(args[0].some(m=>m[0]==='gold_final')){count++;if(count===1){oldArrived();await oldGate;}else if(count===2){newArrived();await newGate;}}return original(...args);};
  try{
   const first=req('/admin/advance-bracket',{});await oldReady;
   const corrected=req('/admin/match/'+semis[0].id+'/score',{s1t1:'20',s1t2:'25',s2t1:'20',s2t2:'25'});await newReady;
   releaseOld();const oldResponse=await first;releaseNew();const correctedResponse=await corrected;
   require('node:assert/strict').equal(oldResponse.status,302);require('node:assert/strict').equal(correctedResponse.status,302);
   const final=adapter.getFullState().matches.find(m=>m.phase==='gold_final');require('node:assert/strict').equal(final.team1_id,semis[0].team2_id);
  }finally{releaseOld();releaseNew();adapter.insertBracketMatches=original;}
 });

});
