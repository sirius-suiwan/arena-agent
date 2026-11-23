import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {botCatalog,loadBotRegistry} from '../apps/cli/bot-registry.js';
import {makeMatch} from '../apps/cli/match-options.js';
import {game} from '../games/tank-trouble/adapter/index.js';
import {recorder,verifyReplay} from '../replay/index.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const declaration={schema:1,protocol:1,id:'agent-fox',name:'新选手',game:game.id,entry:'bot.py',files:['strategy.py']};
const manifest=(dir,body=declaration)=>writeFile(join(dir,'bot.json'),JSON.stringify(body));
async function fixture(t) {
  const tmp=await mkdtemp(join(tmpdir(),'arena-bots-'));
  t.after(()=>rm(tmp,{recursive:true,force:true}));
  const bot=join(tmp,'bots','agent-fox');
  await mkdir(bot,{recursive:true});
  return {tmp,bot};
}

test('discovers an agent Python package and runs it against registered Laika and GPT-dots with verifiable replay',async t=>{
  const {tmp,bot}=await fixture(t);
  for (const folder of ['gpt-dots','laika']) await cp(join(root,'bots',folder),join(tmp,'bots',folder),{recursive:true});
  await manifest(bot);
  await writeFile(join(bot,'strategy.py'),'turn = 1\n');
  await writeFile(join(bot,'bot.py'),[
    'import json, sys','from strategy import turn','for line in sys.stdin:',
    '  msg = json.loads(line)',
    '  response = {"type":"ready","protocol":1} if msg["type"] == "start" else {"type":"action","tick":msg["tick"],"action":{"throttle":0,"turn":turn,"fire":False}}',
    '  print(json.dumps(response), flush=True)'
  ].join('\n')+'\n');
  const registry=await loadBotRegistry(tmp,game.id);
  assert.deepEqual(botCatalog(registry).map(bot=>bot.id),['agent-fox','gpt-dots','laika']);
  assert.deepEqual(botCatalog(registry)[0],{id:'agent-fox',name:'新选手'});
  assert.equal((await loadBotRegistry(tmp,'other-game')).size,0);
  const before=registry.get('agent-fox');
  await writeFile(join(bot,'strategy.py'),'turn = -1\n');
  const updated=await loadBotRegistry(tmp,game.id);
  assert.equal(updated.get('agent-fox').sha256,before.sha256);
  assert.notEqual(updated.get('agent-fox').packageSha256,before.packageSha256);
  const match=await makeMatch({game,root:tmp,base:join(tmp,'runs'),seed:42,maxTicks:90,timeoutMs:1000,
    paths:{A:'laika',B:'agent-fox',C:'gpt-dots'},registry:updated,recorder});
  const result=await match.run();
  const path=join(match.directory,'match.jsonl');
  const data=(await readFile(path,'utf8')).trim().split('\n').map(JSON.parse);
  const start=data[0], ticks=data.filter(row=>row.type==='tick');
  assert.deepEqual(start.readiness,{A:'ready',B:'ready',C:'ready'});
  assert.deepEqual(start.manifest.playerNames,{A:'Laika（复刻）',B:'新选手',C:'GPT-dots'});
  assert.equal(start.manifest.botVersions.A.id,'laika');
  assert.equal(start.manifest.botVersions.B.packageSha256,updated.get('agent-fox').packageSha256);
  assert.ok(ticks.length>0 && ticks.every(tick=>!tick.input.A.fallback && !tick.input.B.fallback && !tick.input.C.fallback));
  assert.equal(ticks[0].input.B.accepted.turn,-1);
  assert.deepEqual(await verifyReplay(path,{[game.id]:game}),{ticks:ticks.length,result});
});

test('rejects duplicate IDs, traversal and symlink escapes',async t=>{
  const {tmp,bot}=await fixture(t);
  const noDeps={...declaration,files:[]};
  await manifest(bot,{...noDeps,entry:'../outside.py'});
  await assert.rejects(loadBotRegistry(tmp,game.id),/agent-fox\/bot.json.*valid/);
  const outside=join(tmp,'outside.py');
  await writeFile(outside,'pass\n');
  await symlink(outside,join(bot,'bot.py'));
  await manifest(bot,noDeps);
  await assert.rejects(loadBotRegistry(tmp,game.id),/outside package/);
  await rm(join(bot,'bot.py'));
  await writeFile(join(bot,'bot.py'),'pass\n');
  await writeFile(join(bot,'second.bot.json'),JSON.stringify(noDeps));
  await assert.rejects(loadBotRegistry(tmp,game.id),/duplicate bot id/);
});
