import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

test('after a natural ten-round web match the same subscriber receives a fresh moving rematch', {timeout:20_000}, async t=>{
  const dir=await mkdtemp(join(tmpdir(),'arena-web-lifecycle-'));
  const botDir=join(dir,'bots','fixture');
  await mkdir(botDir,{recursive:true});
  await writeFile(join(botDir,'bot.json'),JSON.stringify({
    schema:1,protocol:1,id:'fixture',game:'tank-trouble',name:'Fixture',entry:'bot.mjs'
  }));
  await writeFile(join(botDir,'bot.mjs'),`
    import {createInterface} from 'node:readline';
    for await (const line of createInterface({input:process.stdin})) {
      const msg=JSON.parse(line);
      const response=msg.type==='start' ? {type:'ready',protocol:1}
        : {type:'action',tick:msg.tick,action:{throttle:0,turn:1,fire:false}};
      process.stdout.write(JSON.stringify(response)+'\\n');
    }
  `);
  const probe=createServer().listen(0,'127.0.0.1');
  await once(probe,'listening');
  const {port}=probe.address();
  await new Promise(resolve=>probe.close(resolve));
  const base='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,['--input-type=module','-e',`
    import {serve} from './apps/cli/serve.js';
    import {gameForRate} from './games/tank-trouble/adapter/index.js';
    const game=gameForRate(60);
    await serve({game,root:process.env.TEST_ROOT,port:Number(process.env.TEST_PORT),
      base:process.env.TEST_ROOT+'/runs',config:{maxTicks:2}});
  `],{env:{...process.env,TEST_ROOT:dir,TEST_PORT:String(port),XDG_CONFIG_HOME:join(dir,'config')},stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');
  t.after(async ()=>{
    if (child.exitCode===null && child.signalCode===null) child.kill();
    await exited;
    await rm(dir,{recursive:true,force:true});
  });
  const ready=Promise.race([once(child.stdout,'data'),exited.then(()=>assert.fail('fixture server exited'))]);
  await ready;
  const stream=await fetch(base+'/api/events');
  const reader=stream.body.pipeThrough(new TextDecoderStream()).getReader();
  t.after(()=>reader.cancel().catch(()=>{}));
  let pending='';
  async function eventUntil(predicate) {
    for (;;) {
      const delimiter=pending.indexOf('\n\n');
      if (delimiter<0) {
        const {value,done}=await reader.read();
        assert(!done,'event stream ended');
        pending+=value;
        continue;
      }
      const message=pending.slice(0,delimiter);
      pending=pending.slice(delimiter+2);
      if (!message.startsWith('data: ')) continue;
      const event=JSON.parse(message.slice(6));
      assert.notEqual(event.type,'error',event.message);
      if (predicate(event)) return event;
    }
  }
  async function start() {
    const response=await fetch(base+'/api/match',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({mode:'bots',seed:73,roundLimit:10,bots:{A:'fixture',B:'fixture'}})});
    const payload=await response.json();
    assert.equal(response.status,202,JSON.stringify(payload));
    return payload.matchId;
  }
  const first=await start();
  let lastRound=0;
  await eventUntil(event=>{
    if(event.state) lastRound=Math.max(lastRound,event.state.round);
    return event.type==='end';
  });
  assert.equal(lastRound,10);
  const second=await start();
  assert.notEqual(first,second);
  const opened=await eventUntil(event=>event.type==='start');
  assert.equal(opened.manifest.matchId,second);
  assert.deepEqual(opened.readiness,{A:'ready',B:'ready'});
  const tick=await eventUntil(event=>event.type==='tick'&&event.state.tick===1);
  for(const seat of ['A','B']){
    assert.equal(tick.input[seat].fallback,null);
    assert.equal(tick.input[seat].accepted.turn,1);
    assert.notEqual(tick.state.tanks.find(t=>t.id===seat).angle,opened.state.tanks.find(t=>t.id===seat).angle);
  }
  const stopped=await fetch(base+'/api/stop',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({matchId:second})});
  assert.equal(stopped.status,200);
});
