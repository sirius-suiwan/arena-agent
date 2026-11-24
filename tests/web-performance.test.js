import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {readRows} from './fixtures/replay-file.js';
import {gameForRate} from '../games/tank-trouble/adapter/index.js';
import {verifyReplay} from '../replay/index.js';

test('web performance logs count slow and fast real seats, and an unwritable log does not end combat', {timeout:24_000}, async t=>{
  const dir=await mkdtemp(join(tmpdir(),'arena-performance-'));
  for(const name of ['measure-fast','measure-slow']) {
    const botDir=join(dir,'bots',name);
    await mkdir(botDir,{recursive:true});
    await writeFile(join(botDir,'bot.json'),JSON.stringify({
      schema:1,protocol:1,id:name,game:'tank-trouble',name,entry:'bot.mjs'
    }));
    await writeFile(join(botDir,'bot.mjs'),`
      import {createInterface} from 'node:readline';
      import {setTimeout as delay} from 'node:timers/promises';
      // Private fixture source text must never appear in a performance log.
      for await(const line of createInterface({input:process.stdin})) {
        const message=JSON.parse(line);
        if(message.type==='start') {
          process.stdout.write(JSON.stringify({type:'ready',protocol:1})+'\\n');
        } else {
          if(${name==='measure-slow'}&&message.tick<3) await delay(90);
          process.stdout.write(JSON.stringify({
            type:'action',tick:message.tick,action:{throttle:0,turn:1,fire:false}
          })+'\\n');
        }
      }
    `);
  }
  const probe=createServer().listen(0,'127.0.0.1');
  await once(probe,'listening');
  const {port}=probe.address();
  await new Promise(resolve=>probe.close(resolve));
  const url='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,['--input-type=module','-e',`
    import {serve} from './apps/cli/serve.js';
    import {gameForRate} from './games/tank-trouble/adapter/index.js';
    await serve({game:gameForRate(25),root:process.env.TEST_ROOT,base:process.env.TEST_ROOT+'/runs',
      port:Number(process.env.TEST_PORT)});
  `],{env:{...process.env,TEST_ROOT:dir,TEST_PORT:String(port),XDG_CONFIG_HOME:join(dir,'config')},stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');
  let stderr='';
  child.stderr.setEncoding('utf8').on('data',s=>{stderr+=s;});
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null) child.kill();
    await exited;
    await rm(dir,{recursive:true,force:true});
  });
  await Promise.race([once(child.stdout,'data'),exited.then(()=>assert.fail(stderr||'fixture server exited'))]);
  const post=async(path,payload)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)});
  const reply=await fetch(url+'/api/events');
  const reader=reply.body.pipeThrough(new TextDecoderStream()).getReader();
  t.after(()=>reader.cancel().catch(()=>{}));
  let buffer='';
  async function until(predicate) {
    for(;;) {
      const end=buffer.indexOf('\n\n');
      if(end<0) {const r=await reader.read();assert.ok(!r.done);buffer+=r.value;continue;}
      const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
      if(!line.startsWith('data: ')) continue;
      const event=JSON.parse(line.slice(6));
      assert.notEqual(event.type,'error',event.message);
      if(predicate(event)) return event;
    }
  }
  function replayPath(id) {return join(dir,'runs','tank-trouble',id,'match.jsonl.gz');}
  const seats=Object.fromEntries([...'ABCDEFGH'].map(id=>[id,{bot:id==='H'?'measure-slow':'measure-fast'}]));
  const first=await post('/api/match',{mode:'custom',seed:13,seats});
  assert.equal(first.status,202);
  const {matchId:id}=await first.json();
  await until(e=>e.type==='start'&&e.manifest.matchId===id);
  await until(e=>e.type==='tick'&&e.tick>=10);
  const stopped=await post('/api/stop',{matchId:id});
  assert.equal(stopped.status,200);
  assert.equal((await stopped.json()).stopped,true);
  const log=join(dir,'log');
  assert.deepEqual(await readdir(log),[id+'.perf.json']);
  const raw=await readFile(join(log,id+'.perf.json'),'utf8');
  assert.ok(!raw.includes(dir)&&!raw.includes('bot.mjs')&&!raw.includes('Private fixture'));
  assert.doesNotMatch(raw,/"(?:action|observation|submitted|acceptedAction)"\s*:/);
  const stats=JSON.parse(raw);
  assert.equal(stats.schemaVersion,1);
  assert.equal(stats.matchId,id);
  assert.equal(stats.seatCount,8);
  assert.equal(stats.outcome,'stopped');
  assert.ok(stats.startup.countdownMs>=3000);
  assert.equal(stats.seats.H.botId,'measure-slow');
  assert.equal(stats.seats.H.startup.status,'ready');
  assert.ok(stats.seats.H.fallbackReasons.timeout>=3);
  assert.ok(stats.seats.H.longestConsecutiveTimeouts>=3);
  assert.ok(stats.seats.A.accepted>0);
  const game=gameForRate(25);
  const verified=await verifyReplay(replayPath(id),{[game.id]:game});
  const rows=(await readRows(replayPath(id))).filter(r=>r.type==='tick');
  assert.equal(stats.host.ticks,verified.ticks);
  for(const [id,entry] of Object.entries(stats.seats)) {
    assert.equal(entry.responses,rows.length);
    assert.equal(entry.fallbacks,rows.filter(r=>r.input[id].fallback).length);
    assert.equal(entry.accepted+entry.fallbacks,entry.responses);
    assert.equal(entry.responseMs.count,entry.responses);
  }
  assert.equal(stats.host.dispatchBudgetMs.count,rows.length);
  assert.equal(stats.host.tickIntervalMs.count,rows.length-1);
  assert.ok(stats.host.wholeMatch.cpuUserMs>=0);
  assert.ok(stats.host.combat.wallMs<stats.host.wholeMatch.wallMs);

  await rm(log,{recursive:true,force:true});
  await writeFile(log,'Not a directory');
  const second=await post('/api/match',{mode:'local2',seed:12});
  assert.equal(second.status,202);
  const {matchId:next}=await second.json();
  await until(e=>e.type==='start'&&e.manifest.matchId===next);
  await until(e=>e.type==='tick'&&e.tick>=1);
  const done=await post('/api/stop',{matchId:next});
  assert.equal(done.status,200);
  assert.equal((await done.json()).stopped,true);
  assert.ok((await verifyReplay(replayPath(next),{[game.id]:game})).ticks>=2);
  assert.match(stderr,/无法写入本地性能日志/);
});
