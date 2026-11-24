import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeMatch,parseCustomSeats,playersForMode,seatIds} from '../apps/cli/match-options.js';
import {loadBotRegistry} from '../apps/cli/bot-registry.js';
import {game,gameForRate} from '../games/tank-trouble/adapter/index.js';
import {readRows} from './fixtures/replay-file.js';
import {recorder,REPLAY_FILENAME,verifyReplay} from '../replay/index.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const readLog=async directory=>readRows(join(directory,REPLAY_FILENAME));

test('custom roster validates closed seat IDs, registered bots and exclusive human controls',()=>{
  const registry=new Map([['gpt-dots',{}]]);
  const arrows={control:'arrows'}, esdf={control:'esdf'}, mouse={control:'mouse'}, bot={bot:'gpt-dots'};
  assert.deepEqual(parseCustomSeats({H:mouse,F:esdf,B:bot,A:arrows},registry),{
    ids:['A','B','F','H'],paths:{B:'gpt-dots'},humanControls:{A:'arrows',F:'esdf',H:'mouse'}
  });
  for (const seats of [{}, {A:arrows}, {A:arrows,I:bot}, {A:arrows,B:{bot:'unknown'}},
    {A:arrows,B:{bot:'../bot.py'}}, {A:arrows,B:{bot:'gpt-dots',control:'mouse'}}, {A:arrows,B:{control:'nope'}},
    {A:arrows,B:arrows,C:esdf,D:mouse}, {A:bot,B:bot,C:bot,D:bot,E:bot,F:bot,G:bot,H:bot,I:bot}]) {
    assert.throws(()=>parseCustomSeats(seats,registry));
  }
  assert.deepEqual(playersForMode('bots',{D:'gpt-dots',H:'gpt-dots'}),['A','B','D','H']);
  assert.deepEqual(playersForMode('local3'),['A','B','C']);
});

test('eight independent bot seats record and verify the same authoritative ticks',async t=>{
  const base=await mkdtemp(join(tmpdir(),'arena-eight-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const registry=await loadBotRegistry(root,game.id);
  const ids=['laika','laika','gpt-dots','gpt-dots','laika','gpt-dots','laika','gpt-dots'];
  const selected=gameForRate(60);
  const match=await makeMatch({game:selected,root,base,seed:123,mode:'custom',maxTicks:72,timeoutMs:1000,
    roster:Object.fromEntries(seatIds.map((id,i)=>[id,{bot:ids[i]}])),registry,recorder});
  const result=await match.run();
  const [start,...rows]=await readLog(match.directory);
  const ticks=rows.filter(row=>row.type==='tick');
  assert.equal(start.manifest.rulesVersion,selected.version);
  assert.equal(start.manifest.tickRate,selected.tickRate);
  assert.deepEqual(start.manifest.players,seatIds);
  assert.deepEqual(start.manifest.humanControls,{});
  assert.deepEqual(seatIds.map(id=>start.manifest.botVersions[id].id),ids);
  assert.ok(seatIds.every(id=>start.readiness[id]==='ready'));
  assert.equal(ticks.length,72);
  assert.ok(ticks.every(row=>seatIds.every(id=>!row.input[id].fallback)));
  assert.deepEqual(await verifyReplay(join(match.directory,REPLAY_FILENAME),{
    [selected.id+'@'+selected.version]:selected
  }),{ticks:ticks.length,result});
});

test('sparse mixed roster keeps bot and human seat identity at 30 Hz',async t=>{
  const base=await mkdtemp(join(tmpdir(),'arena-mixed-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const registry=await loadBotRegistry(root,game.id);
  const dir=()=>({act:()=>({value:{throttle:0,turn:1,fire:false}})});
  const selected=gameForRate(30);
  const match=await makeMatch({game:selected,root,base,seed:12,mode:'custom',maxTicks:15,timeoutMs:1000,
    roster:{B:{control:'esdf'},C:{bot:'laika'},E:{control:'arrows'},H:{control:'mouse'}},
    human:{B:dir(),E:dir(),H:dir()},playerNames:{H:'鼠标玩家'},registry,recorder});
  await match.run();
  const [start,tick]=await readLog(match.directory);
  assert.deepEqual(start.manifest.players,['B','C','E','H']);
  assert.deepEqual(start.manifest.humanControls,{B:'esdf',E:'arrows',H:'mouse'});
  assert.equal(start.manifest.playerNames.H,'鼠标玩家');
  assert.equal(start.manifest.botVersions.H.kind,'human');
  assert.equal(tick.input.H.accepted.turn,1);
  assert.equal((await verifyReplay(join(match.directory,REPLAY_FILENAME),{[selected.id+'@'+selected.version]:selected})).ticks,15);

});

test('seven slow process startups do not disable seats or extend their normal action timeout',async t=>{
  const base=await mkdtemp(join(tmpdir(),'arena-seven-delayed-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const ids=seatIds.slice(0,7);
  const game=gameForRate(60);
  const path=join(root,'tests/fixtures/slow-jsonl-seat.mjs');
  const match=await makeMatch({game,root,base,seed:123,maxTicks:8,timeoutMs:50,
    paths:Object.fromEntries(ids.map(id=>[id,path])),recorder});
  const result=await match.run();
  const [start,...rows]=await readLog(match.directory);
  const ticks=rows.filter(row=>row.type==='tick');
  assert.deepEqual(start.readiness,Object.fromEntries(ids.map(id=>[id,'ready'])));
  assert.ok(ids.every(id=>ticks[1].input[id].fallback==='timeout'));
  assert.ok(ids.every(id=>ticks.slice(2).some(r=>r.input[id].accepted.throttle===1)));
  assert.deepEqual(await verifyReplay(join(match.directory,REPLAY_FILENAME),{[game.id]:game}),{ticks:8,result});
});
