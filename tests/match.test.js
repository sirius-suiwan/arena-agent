import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runMatch} from '../core/match.js';
import {readRows,writeRows} from './fixtures/replay-file.js';
import {recorder,REPLAY_FILENAME,verifyReplay,readReplay} from '../replay/index.js';
import {makeMatch} from '../apps/cli/match-options.js';
import {LocalBot} from '../runners/local-process/index.js';
import {game} from '../games/tank-trouble/adapter/index.js';
import {withLaikaInsight} from '../games/tank-trouble/bots/laika-insight.js';
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
  const path=join(directory,REPLAY_FILENAME);
  const data=await readRows(path);
  assert.deepEqual(data[0].manifest.players,['A','B']);
  assert.equal(data[0].manifest.tickRate,10);
  assert.deepEqual(data[1].input.B,{submitted:null,accepted:{jump:false},fallback:'timeout'});
  assert.equal((await verifyReplay(path,{'jump-fixture':jumpGame})).ticks,2);
  assert.equal(data[0].manifest.format,2);
  assert.ok(data.every(row=>!Object.hasOwn(row,'state')));
  const full=await Array.fromAsync(readReplay(path,{'jump-fixture':jumpGame}));
  assert.deepEqual(full[1].state.heights,{A:1,B:0});
  assert.deepEqual(jumpGame.observe(full[0].state,'B'),{height:0});
  assert.ok(data.filter(row=>row.type==='tick').every(row=>Object.values(row.input).every(entry=>!Object.hasOwn(entry,'observation'))));
  await writeRows(path,[{...data[0],manifest:{...data[0].manifest,format:1}},...data.slice(1)]);
  await assert.rejects(verifyReplay(path,{'jump-fixture':jumpGame}), /tick 0: missing or unsupported start/);
  data[1].input.A.accepted.jump=false;
  await writeRows(path,data);
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
  const match=await makeMatch({game,root,base,seed:42,maxTicks:180,timeoutMs:1000,paths:{B:join(root,'tests/fixtures/jsonl-seat.py')},playerNames:{A:' 主机名 '},recorder});
  const result=await match.run();
  const dump=await readRows(join(match.directory,REPLAY_FILENAME));
  assert.deepEqual(dump[0].readiness,{A:'ready',B:'ready'});
  assert.deepEqual(dump[0].manifest.playerNames,{A:'主机名',B:'Python 测试席'});
  assert.equal(dump[0].manifest.rulesVersion,game.version);
  const frames=await Array.fromAsync(readReplay(join(match.directory,REPLAY_FILENAME),{[game.id]:game}));
  assert.equal(frames[0].state.shellLimit,10);
  assert.equal(frames[0].state.config.shellSpeed,144/game.tickRate);
  assert.equal(dump[0].manifest.matchId,match.matchId);
  assert.equal(basename(match.directory),match.matchId);
  assert.equal(JSON.parse(await readFile(join(match.directory,'manifest.json'),'utf8')).matchId,match.matchId);
  assert.deepEqual(JSON.parse(await readFile(join(match.directory,'result.json'),'utf8')),result);
  assert.deepEqual([frames[0].state.width,frames[0].state.height],[768,576]);
  const ticks=dump.filter(r=>r.type==='tick');
  assert.ok(ticks.length>0 && ticks.every(r=>!r.input.A.fallback && !r.input.B.fallback));
  assert.deepEqual(await verifyReplay(join(match.directory,REPLAY_FILENAME),{[game.id]:game}),{ticks:ticks.length,result});
  await writeRows(join(match.directory,'truncated.jsonl.gz'),dump.slice(0,-1));
  await assert.rejects(verifyReplay(join(match.directory,'truncated.jsonl.gz'),{[game.id]:game}), /missing end/);
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

test('stopping during startup through the built-in wrapper closes the child and records no game ticks',async t=>{
  const bot=new LocalBot(process.execPath,[join(root,'tests/fixtures/slow-jsonl-seat.mjs')]);
  t.after(()=>bot.close());
  const controller=new AbortController(), recorded=[];
  const closed=runMatch({game:jumpGame,seed:17,maxTicks:3,seats:{A:withLaikaInsight(bot)},signal:controller.signal,
    record:r=>recorded.push(r)});
  controller.abort();
  assert.deepEqual(await closed,{winner:null,reason:'stopped'});
  assert.deepEqual(recorded.map(r=>r.type),['start','end']);
  assert.deepEqual(recorded[0].readiness,{A:'startup_aborted'});
  assert.equal(bot.dead,true);
});
