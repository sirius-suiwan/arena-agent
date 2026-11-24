import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {request} from 'node:http';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {test} from 'node:test';
import {gameForRate} from '../games/tank-trouble/adapter/index.js';
import {verifyReplay} from '../replay/index.js';
import {readRows,writeRows} from './fixtures/replay-file.js';

async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'arena-startup-'));
  for(const [id,name,wait] of [['quick','已准备选手',0],['late','较晚选手',2250],['bad','故障选手',-1],['drops','掉线选手',10]]) {
    const path=join(dir,'bots',id);
    await mkdir(path,{recursive:true});
    await writeFile(join(path,'bot.json'),JSON.stringify({schema:1,protocol:1,id,game:'tank-trouble',name,entry:'bot.mjs'}));
    await writeFile(join(path,'bot.mjs'),`
      import {createInterface} from 'node:readline';
      import {appendFileSync} from 'node:fs';
      import {setTimeout as delay} from 'node:timers/promises';
      for await(const line of createInterface({input:process.stdin})) {
        const m=JSON.parse(line);
        if(m.type==='start') {
          if(${wait}<0) { process.stdout.write('invalid\\n'); continue; }
          await delay(${Math.max(0,wait)});
          process.stdout.write(JSON.stringify({type:'ready',protocol:1})+'\\n');
          if(${JSON.stringify(id)}==='drops') setTimeout(()=>process.exit(0),300);
        } else {
          if(m.tick===0) appendFileSync(process.env.TEST_MARKER,'observed\\n');
          process.stdout.write(JSON.stringify({type:'action',tick:m.tick,action:{throttle:0,turn:1,fire:false}})+'\\n');
        }
      }
    `);
  }
  const probe=createServer().listen(0,'127.0.0.1');
  await once(probe,'listening');
  const {port}=probe.address();
  await new Promise(resolve=>probe.close(resolve));
  const url='http://127.0.0.1:'+port;
  const marker=join(dir,'observed');
  const child=spawn(process.execPath,['--input-type=module','-e',`
    import {serve} from './apps/cli/serve.js';
    import {gameForRate} from './games/tank-trouble/adapter/index.js';
    await serve({game:gameForRate(25),root:process.env.TEST_ROOT,base:process.env.TEST_ROOT+'/runs',
      port:Number(process.env.TEST_PORT)});
  `],{env:{...process.env,TEST_ROOT:dir,TEST_PORT:String(port),TEST_MARKER:marker,XDG_CONFIG_HOME:join(dir,'config')},stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null) child.kill();
    await exited;
    await rm(dir,{recursive:true,force:true});
  });
  await Promise.race([once(child.stdout,'data'),exited.then(()=>assert.fail('fixture server exited'))]);
  const post=async(path,payload)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)});
  const start=async payload=>{
    const response=await post('/api/match',{seed:13,...payload});
    assert.equal(response.status,202);
    return (await response.json()).matchId;
  };
  const events=async()=>{
    const reply=await fetch(url+'/api/events');
    const reader=reply.body.pipeThrough(new TextDecoderStream()).getReader();
    t.after(()=>reader.cancel().catch(()=>{}));
    let buffer='';
    return {close:()=>reader.cancel(),async next(predicate){
      for(;;) {
        const end=buffer.indexOf('\n\n');
        if(end<0) {
          const r=await reader.read();
          assert.ok(!r.done,'SSE unexpectedly ended');buffer+=r.value;continue;
        }
        const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(!line.startsWith('data: ')) continue;
        const event=JSON.parse(line.slice(6));
        if(predicate(event)) return event;
      }
    }};
  };
  return {url,marker,post,start,events,path:id=>join(dir,'runs','tank-trouble',id,'match.jsonl.gz')};
}

const game=gameForRate(25);
const registry={[game.id]:game};
const when=(id,phase)=>e=>e.type==='startup'&&e.matchId===id&&e.phase===phase;
const neutral={throttle:0,turn:0,fire:false};

test('web gate reports late bots, then holds all seven until a full countdown and drops early human input', {timeout:14_000}, async t=>{
  const web=await fixture(t);
  const live=await web.events();
  const seats=Object.fromEntries([...'BCDEFGH'].map(id=>[id,{bot:id==='H'?'late':'quick'}]));
  const id=await web.start({mode:'custom',seats:{A:{control:'arrows'},...seats}});
  const progress=await live.next(e=>when(id,'waiting')(e)&&e.seats.B.status==='ready');
  assert.equal(progress.seats.A.status,'ready');
  assert.deepEqual(progress.seats.H,{name:'较晚选手',status:'pending'});
  const pre=await web.post('/api/input',{matchId:id,playerId:'A',throttle:1,turn:0,fire:true});
  assert.equal(pre.status,409);
  const countdown=await live.next(when(id,'countdown'));
  const began=performance.now();
  assert.equal(countdown.countdownMs,3000);
  assert.ok(countdown.remainingMs>=2950);
  assert.ok(Object.values(countdown.seats).every(s=>s.status==='ready'));
  await assert.rejects(readFile(web.marker),{code:'ENOENT'});
  const played={matchId:id,playerId:'A',throttle:1,turn:0,fire:true};
  let stalled;
  const stale=new Promise((resolve,reject)=>{
    stalled=request(web.url+'/api/input',{method:'POST',headers:{'Content-Type':'application/json'}},
      res=>{res.resume();resolve(res.statusCode);});
    stalled.on('error',reject);
    stalled.write('{');
  });
  t.after(()=>stalled.destroy());
  await delay(180);
  const reconnect=await web.events();
  const snap=await reconnect.next(()=>true);
  assert.ok(when(id,'countdown')(snap));
  assert.ok(snap.remainingMs<countdown.remainingMs);
  assert.deepEqual(snap.seats,countdown.seats);
  await reconnect.close();
  const opened=await live.next(e=>e.type==='start'&&e.manifest.matchId===id);
  assert.ok(performance.now()-began>=2850,'the host cut short its opening countdown');
  assert.ok(Object.values(opened.readiness).every(r=>r==='ready'));
  stalled.end(JSON.stringify(played).slice(1));
  assert.equal(await stale,409);
  const tick=await live.next(e=>e.type==='tick'&&e.tick===0);
  assert.deepEqual(tick.input.A.accepted,neutral);
  assert.ok(Object.keys(seats).every(s=>tick.input[s].accepted.turn===1));
  assert.equal((await web.post('/api/input',played)).status,200);
  const actual=await live.next(e=>e.type==='tick'&&e.input.A.accepted.fire);
  assert.equal(actual.input.A.accepted.throttle,1);
  const done=await web.post('/api/stop',{matchId:id});
  assert.equal(done.status,200);
  assert.equal((await done.json()).stopped,true);
  const replay=await verifyReplay(web.path(id),registry);
  assert.ok(replay.ticks>0);
  assert.equal(replay.result.reason,'stopped');
});

test('failed and cancelled preparation persist terminal snapshots and verifiable zero-tick recordings', {timeout:12_000}, async t=>{
  const web=await fixture(t);
  const live=await web.events();
  const fail=await web.start({mode:'custom',seats:{A:{control:'arrows'},E:{bot:'bad'}},
    playerNames:{E:'自定义故障名'}});
  const phases=[];
  const failure=await live.next(e=>{phases.push(e.type==='startup'?e.phase:e.type);return when(fail,'failed')(e);});
  assert.ok(!phases.includes('countdown')&&!phases.includes('start')&&!phases.includes('tick'));
  assert.deepEqual(failure.seats.E,{name:'自定义故障名',status:'failed',error:'invalid_json'});
  assert.match(failure.message,/自定义故障名（E）/);
  const reconnect=await web.events();
  assert.deepEqual(await reconnect.next(()=>true),failure);
  await reconnect.close();
  const path=web.path(fail);
  assert.deepEqual(await verifyReplay(path,registry),{ticks:0,result:{winner:null,reason:'startup_failed'}});
  const rows=await readRows(path);
  rows[0].readiness.E='ready';
  await writeRows(path,rows);
  await assert.rejects(verifyReplay(path,registry),/result differs/);
  const drop=await web.start({mode:'custom',seats:{A:{control:'arrows'},B:{bot:'drops'}}});
  await live.next(when(drop,'countdown'));
  const dropped=await live.next(e=>{
    assert.ok(e.type!=='start'&&e.type!=='tick','a bot exited during the countdown');
    return when(drop,'failed')(e);
  });
  assert.deepEqual(dropped.seats.B,{name:'掉线选手',status:'failed',error:'process_exit'});
  assert.deepEqual(await verifyReplay(web.path(drop),registry),{ticks:0,result:{winner:null,reason:'startup_failed'}});
  for(const phase of ['waiting','countdown']) {
    const id=await web.start(phase==='waiting'
      ? {mode:'custom',seats:{A:{control:'arrows'},B:{bot:'late'}}}:{mode:'local2'});
    await live.next(when(id,phase));
    const timeout=performance.now();
    const stop=await web.post('/api/stop',{matchId:id});
    assert.equal(stop.status,200);
    assert.equal((await stop.json()).stopped,true);
    assert.ok(performance.now()-timeout<2500,'pre-combat stop waited for the startup timer');
    await live.next(when(id,'cancelled'));
    assert.deepEqual(await verifyReplay(web.path(id),registry),{ticks:0,result:{winner:null,reason:'stopped'}});
  }
  await assert.rejects(readFile(web.marker),{code:'ENOENT'});
});
