import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runMatch} from '../core/match.js';
import {recorder,verifyReplay} from '../replay/index.js';
import {jumpGame} from './fixtures/jump-game.js';

test('stop completes the in-flight tick, closes seats and saves a verifiable replay without a winner',async t=>{
  const controller=new AbortController(),observed=[];
  const directory=await mkdtemp(join(tmpdir(),'arena-stop-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const disk=await recorder(directory);
  let closed=false;
  const result=await runMatch({
    game:jumpGame,seats:{A:{act:({tick})=>{
      observed.push(tick);
      controller.abort();
      return {value:{jump:true}};
    },close:()=>{closed=true;}}},
    seed:7,maxTicks:3,signal:controller.signal,record:frame=>disk.write(frame)
  }).finally(disk.close);
  assert.deepEqual(observed,[0]);
  assert.equal(closed,true);
  assert.deepEqual(result,{winner:null,reason:'stopped'});
  const path=join(directory,'match.jsonl');
  assert.deepEqual(await verifyReplay(path,{[jumpGame.id]:jumpGame}),{ticks:1,result});
  const records=(await readFile(path,'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(r=>r.type),['start','tick','end']);
  records.at(-1).result.winner='A';
  await writeFile(path,records.map(JSON.stringify).join('\n')+'\n');
  await assert.rejects(verifyReplay(path,{[jumpGame.id]:jumpGame}),/result differs/);
});

test('a natural winning tick remains a win even if a stop is requested during that tick',async()=>{
  const controller=new AbortController();
  const game={...jumpGame,step(state){
    return {state:{...state,tick:state.tick+1},events:[],result:{winner:'A',reason:'win'}};
  }};
  const result=await runMatch({
    game,seats:{A:{act:()=>{controller.abort();return {value:{jump:true}};}}},
    seed:7,maxTicks:10,signal:controller.signal,record:()=>{}
  });
  assert.deepEqual(result,{winner:'A',reason:'win'});
});
