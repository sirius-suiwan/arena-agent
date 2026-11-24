import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readRows} from './fixtures/replay-file.js';
import {gameForRate} from '../games/tank-trouble/adapter/index.js';
import {readReplay,verifyReplay} from '../replay/index.js';

const root=fileURLToPath(new URL('../',import.meta.url));

test('live viewer receives the current zone but not its future center; recordings reconstruct it',async t=>{
  const temp=await mkdtemp(join(tmpdir(),'arena-zone-viewer-'));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const portProbe=createServer().listen(0,'127.0.0.1');
  await once(portProbe,'listening');
  const {port}=portProbe.address();
  await new Promise(resolve=>portProbe.close(resolve));
  const child=spawn(process.execPath,['apps/cli/arena.js','serve','--port',String(port),'--out',temp],{
    cwd:root,env:{...process.env,XDG_CONFIG_HOME:join(temp,'config')},stdio:['ignore','ignore','pipe']
  });
  const exited=once(child,'exit');
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null) child.kill();await exited;});
  let stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const origin='http://127.0.0.1:'+port, api=(path,options)=>fetch(origin+path,{signal:AbortSignal.timeout(8000),...options});
  const post=(path,data)=>api(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
  let options;
  for(let i=0;i<100;i++){
    options=await api('/api/options').catch(()=>null);
    if(options?.ok||child.exitCode!==null) break;
    await delay(20);
  }
  assert.equal(options?.status,200,stderr);
  assert.equal((await options.json()).shrinkCenter,'center');
  const response=await post('/api/match',{mode:'human',seed:17,shrinkCenter:'random',shrinkAfterSeconds:2,shrinkDurationSeconds:1});
  assert.equal(response.status,202);
  const {matchId}=await response.json();
  const game=gameForRate(25);
  const stream=await api('/api/events');
  const reader=stream.body.getReader();
  const frames=[];
  let pending='';
  try {
    const decoder=new TextDecoder();
    while(!frames.some(e=>e.type==='tick'&&e.state.roundTick>e.state.zone.startTick)) {
      const {value,done}=await reader.read();
      assert.ok(!done,'stream ended before shrinking');
      pending+=decoder.decode(value,{stream:true});
      const lines=pending.split('\n\n'); pending=lines.pop();
      for(const line of lines) if(line.startsWith('data: ')) frames.push(JSON.parse(line.slice(6)));
    }
  } finally {await reader.cancel();}
  const start=frames.find(frame=>frame.type==='start');
  assert.equal(start.manifest.config.shrinkCenter,'random');
  assert.deepEqual(start.manifest.inputInsight,{seats:['B'],timing:'concurrent',capabilities:['pickup-forecast','shrink-destination']});
  assert.ok(frames.every(frame=>!JSON.stringify(frame).includes('"zoneDestination"')&&!JSON.stringify(frame).includes('"shrinkDestination"')));
  assert.equal(frames.find(e=>e.type==='tick'&&e.state.roundTick>start.state.zone.startTick).state.zone.halfWidth<start.state.zone.halfWidth,true);
  const stopped=await post('/api/stop',{matchId});
  assert.equal(stopped.status,200);
  assert.equal((await stopped.json()).stopped,true);
  const path=join(temp,'tank-trouble',matchId,'match.jsonl.gz');
  const registry={[game.id+'@'+game.version]:game};
  const {ticks,result}=await verifyReplay(path,registry);
  assert.ok(ticks>start.state.zone.startTick);
  assert.deepEqual(result,{winner:null,reason:'stopped'});
  assert.ok((await readRows(path)).every(frame=>!JSON.stringify(frame).includes('"zoneDestination"')&&!JSON.stringify(frame).includes('"shrinkDestination"')));
  for await(const frame of readReplay(path,registry)) {
    if(frame.type==='start') assert.ok(frame.state.zoneDestination);
  }
});
