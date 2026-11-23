import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runMatch} from '../core/match.js';
import {recorder,verifyReplay} from '../replay/index.js';
import {makeMatch} from '../apps/cli/match-options.js';
import {LocalBot} from '../runners/local-process/index.js';
import {game} from '../games/tank-trouble/adapter/index.js';
import {jumpGame} from './fixtures/jump-game.js';

const root = fileURLToPath(new URL('../',import.meta.url));
async function folder(t) {
  const directory=await mkdtemp(join(tmpdir(),'arena-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return directory;
}

test('generic host handles different game action schema and records same-tick fallback',async t=>{
  const directory=await folder(t);
  const disk=await recorder(directory);
  let closed=0;
  const a = {act: ({tick,observation})=>{
    assert.equal(observation.height,tick===0 ? 0 : 1);
    return {value:{jump:true}};
  },close:()=>closed++};
  const b={act:()=>({error:'timeout'}),close:()=>closed++};
  try {
    assert.deepEqual(await runMatch({
      game:jumpGame,seats:{B:b,A:a},seed:7,maxTicks:2,record:obj=>disk.write(obj)
    }),{winner:null,reason:'tick_limit'});
  } finally {await disk.close();}
  assert.equal(closed,2);
  const path=join(directory,'match.jsonl');
  const data=(await readFile(path,'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(data[0].manifest.players,['A','B']);
  assert.equal(data[0].manifest.tickRate,10);
  assert.deepEqual(data[1].input.B,{observation:{height:0},submitted:null,accepted:{jump:false},fallback:'timeout'});
  assert.equal((await verifyReplay(path,{'jump-fixture':jumpGame})).ticks,2);
  data[1].state.heights.A=0;
  await writeFile(path,data.map(JSON.stringify).join('\n')+'\n');
  await assert.rejects(verifyReplay(path,{'jump-fixture':jumpGame}), /tick 0: state differs/);
});

test('runs independent JS and Python bots and replays a tank match',async t=>{
  const base=await folder(t);
  const match=await makeMatch({game,root,base,seed:42,maxTicks:180,timeoutMs:1000,paths:{B:join(root,'bots/examples/scout.py')},recorder});
  const result=await match.run();
  const dump=(await readFile(join(match.directory,'match.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(dump[0].readiness,{A:'ready',B:'ready'});
  const ticks=dump.filter(r=>r.type==='tick');
  assert.ok(ticks.length>0 && ticks.every(r=>!r.input.A.fallback && !r.input.B.fallback));
  assert.deepEqual(await verifyReplay(join(match.directory,'match.jsonl'),{[game.id]:game}),{ticks:ticks.length,result});
  await writeFile(join(match.directory,'truncated.jsonl'),dump.slice(0,-1).map(JSON.stringify).join('\n'));
  await assert.rejects(verifyReplay(join(match.directory,'truncated.jsonl'),{[game.id]:game}), /missing end/);
});

test('local transport discards stale tick replies and bounds action timeout',async()=>{
  const source=`
    const rl = require('node:readline').createInterface({input:process.stdin});
    rl.on('line', line => {
      const msg = JSON.parse(line);
      if (msg.type === 'start') console.log(JSON.stringify({type:'ready',protocol:1}));
      if (msg.tick === 1) {
        console.log(JSON.stringify({type:'action',tick:0,action:{bad:true}}));
        console.log(JSON.stringify({type:'action',tick:1,action:{jump:true}}));
      }
    });`;
  const bot=new LocalBot(process.execPath,['--input-type=commonjs','-e',source]);
  try {
    assert.deepEqual(await bot.start({type:'start'}),{value:null});
    assert.deepEqual(await bot.act({type:'observe',tick:0},40),{error:'timeout'});
    assert.deepEqual(await bot.act({type:'observe',tick:1},1000),{value:{jump:true}});
  } finally {bot.close();}
});
