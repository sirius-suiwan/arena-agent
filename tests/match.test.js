import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runMatch,stateHash} from '../core/match.js';
import {recorder,verifyReplay} from '../replay/index.js';
import {makeMatch} from '../apps/cli/match-options.js';
import {LocalBot} from '../runners/local-process/index.js';
import {game,gameV1,gameV2} from '../games/tank-trouble/adapter/index.js';
import {normalizePlayerName} from '../protocol/bot/player-name.js';
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

test('player display names strip controls and cap Unicode without changing seat identity',()=>{
  assert.equal(normalizePlayerName('  红队   🐢  '),'红队 🐢');
  assert.equal(normalizePlayerName('\u202e测试\u0000'),'测试');
  assert.equal(normalizePlayerName('\u200b  '),null);
  assert.equal([...normalizePlayerName('🐢'.repeat(26))].length,24);
});

test('runs independent JS and Python bots and replays a tank match',async t=>{
  const base=await folder(t);
  const match=await makeMatch({game,root,base,seed:42,maxTicks:180,timeoutMs:1000,paths:{B:join(root,'bots/examples/scout.py')},playerNames:{A:' 主机名 '},recorder});
  const result=await match.run();
  const dump=(await readFile(join(match.directory,'match.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(dump[0].readiness,{A:'ready',B:'ready'});
  assert.deepEqual(dump[0].manifest.playerNames,{A:'主机名',B:'斥候'});
  assert.equal(dump[0].manifest.rulesVersion,'3');
  assert.equal(dump[0].manifest.matchId,match.matchId);
  assert.equal(basename(match.directory),match.matchId);
  assert.equal(JSON.parse(await readFile(join(match.directory,'manifest.json'),'utf8')).matchId,match.matchId);
  assert.deepEqual([dump[0].state.width,dump[0].state.height],[768,576]);
  const ticks=dump.filter(r=>r.type==='tick');
  assert.ok(ticks.length>0 && ticks.every(r=>!r.input.A.fallback && !r.input.B.fallback));
  assert.deepEqual(await verifyReplay(join(match.directory,'match.jsonl'),{[game.id]:game}),{ticks:ticks.length,result});
  await writeFile(join(match.directory,'truncated.jsonl'),dump.slice(0,-1).map(JSON.stringify).join('\n'));
  await assert.rejects(verifyReplay(join(match.directory,'truncated.jsonl'),{[game.id]:game}), /missing end/);
});

test('prior v1 logs select the frozen rules when v2 and v3 are present',async t=>{
  const base=await folder(t);
  const match=await makeMatch({game:gameV1,root,base,seed:42,maxTicks:12,timeoutMs:1000,recorder});
  const result=await match.run();
  const registry={['tank-trouble@1']:gameV1,['tank-trouble@2']:gameV2,['tank-trouble@3']:game};
  const file=join(match.directory,'match.jsonl');
  assert.deepEqual((await verifyReplay(file,registry)).result,result);
  await assert.rejects(verifyReplay(file,{'tank-trouble':game}), /unknown rules version/);
});

test('v2 adapter retains its historical start state in a mixed-version registry',async t=>{
  const starting=gameV2.init({seed:37,config:{},players:['A','B']});
  assert.equal(stateHash(starting),'89f16e09b424459ef554ba7fb60e4394fe7f604a32172fddc468b7494c76b136');
  const base=await folder(t);
  const match=await makeMatch({game:gameV2,root,base,seed:37,maxTicks:12,timeoutMs:1000,recorder});
  const result=await match.run();
  const file=join(match.directory,'match.jsonl');
  assert.deepEqual((await verifyReplay(file,{'tank-trouble@2':gameV2,[game.id]:game})).result,result);
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
