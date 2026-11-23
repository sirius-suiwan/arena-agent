import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeMatch,parseCustomSeats,playersForMode,seatIds} from '../apps/cli/match-options.js';
import {loadBotRegistry} from '../apps/cli/bot-registry.js';
import {game,gameV4,gameV5} from '../games/tank-trouble/adapter/index.js';
import {recorder,verifyReplay} from '../replay/index.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const readLog=async directory=>(await readFile(join(directory,'match.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);

test('custom roster validates closed seat IDs, registered bots and exclusive human controls',()=>{
  const registry=new Map([['turret',{}]]);
  const arrows={control:'arrows'}, esdf={control:'esdf'}, mouse={control:'mouse'}, bot={bot:'turret'};
  assert.deepEqual(parseCustomSeats({H:mouse,F:esdf,B:bot,A:arrows},registry),{
    ids:['A','B','F','H'],paths:{B:'turret'},humanControls:{A:'arrows',F:'esdf',H:'mouse'}
  });
  for (const seats of [{}, {A:arrows}, {A:arrows,I:bot}, {A:arrows,B:{bot:'unknown'}},
    {A:arrows,B:{bot:'../bot.py'}}, {A:arrows,B:{bot:'turret',control:'mouse'}}, {A:arrows,B:{control:'nope'}},
    {A:arrows,B:arrows,C:esdf,D:mouse}, {A:bot,B:bot,C:bot,D:bot,E:bot,F:bot,G:bot,H:bot,I:bot}]) {
    assert.throws(()=>parseCustomSeats(seats,registry));
  }
  assert.deepEqual(playersForMode('bots',{D:'turret',H:'turret'}),['A','B','D','H']);
  assert.deepEqual(playersForMode('local3'),['A','B','C']);
});

test('eight independent bot seats record and verify the same authoritative ticks',async t=>{
  const base=await mkdtemp(join(tmpdir(),'arena-eight-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const registry=await loadBotRegistry(root,game.id);
  const ids=['laika','scout','turret','turret','scout','turret','laika','turret'];
  const match=await makeMatch({game,root,base,seed:123,mode:'custom',maxTicks:72,timeoutMs:1000,
    roster:Object.fromEntries(seatIds.map((id,i)=>[id,{bot:ids[i]}])),registry,recorder});
  const result=await match.run();
  const [start,...rows]=await readLog(match.directory);
  const ticks=rows.filter(row=>row.type==='tick');
  assert.equal(start.manifest.rulesVersion,'7');
  assert.deepEqual(start.manifest.players,seatIds);
  assert.deepEqual(start.manifest.humanControls,{});
  assert.deepEqual(seatIds.map(id=>start.manifest.botVersions[id].id),ids);
  assert.ok(seatIds.every(id=>start.readiness[id]==='ready'));
  assert.equal(ticks.length,72);
  assert.ok(ticks.every(row=>seatIds.every(id=>!row.input[id].fallback)));
  assert.deepEqual(await verifyReplay(join(match.directory,'match.jsonl'),{
    [game.id+'@7']:game,[game.id+'@5']:gameV5,[game.id+'@4']:gameV4
  }),{ticks:ticks.length,result});
});

test('sparse mixed roster keeps bot and human seat identity; v4 records still verify',async t=>{
  const base=await mkdtemp(join(tmpdir(),'arena-mixed-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const registry=await loadBotRegistry(root,game.id);
  const dir=()=>({act:()=>({value:{throttle:0,turn:1,fire:false}})});
  const match=await makeMatch({game,root,base,seed:12,mode:'custom',maxTicks:15,timeoutMs:1000,
    roster:{B:{control:'esdf'},C:{bot:'laika'},E:{control:'arrows'},H:{control:'mouse'}},
    human:{B:dir(),E:dir(),H:dir()},playerNames:{H:'鼠标玩家'},registry,recorder});
  await match.run();
  const [start,tick]=await readLog(match.directory);
  assert.deepEqual(start.manifest.players,['B','C','E','H']);
  assert.deepEqual(start.manifest.humanControls,{B:'esdf',E:'arrows',H:'mouse'});
  assert.equal(start.manifest.playerNames.H,'鼠标玩家');
  assert.equal(start.manifest.botVersions.H.kind,'human');
  assert.equal(tick.input.H.accepted.turn,1);
  assert.equal((await verifyReplay(join(match.directory,'match.jsonl'),{'tank-trouble@7':game})).ticks,15);

  const old=await makeMatch({game:gameV4,root,base,seed:42,maxTicks:12,timeoutMs:1000,registry,recorder});
  await old.run();
  assert.equal((await verifyReplay(join(old.directory,'match.jsonl'),{'tank-trouble@4':gameV4,'tank-trouble@7':game})).ticks,12);
});
