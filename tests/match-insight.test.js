import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runMatch} from '../core/match.js';
import {makeMatch} from '../apps/cli/match-options.js';
import {loadBotRegistry} from '../apps/cli/bot-registry.js';
import {game} from '../games/tank-trouble/adapter/index.js';
import {jumpGame} from './fixtures/jump-game.js';

test('eight seats dispatch together at full budget even with private forecast seats',async()=>{
  const records=[], started=[];
  const ids=[...'ABCDEFGH'];
  const game={...jumpGame,insightCapabilities:['sample'],privilegedObservation:()=>({pickupForecast:{attemptTick:1}})};
  const seats=Object.fromEntries(ids.map(id=>[id,{async act(msg,budget){
    assert.equal(budget,250);
    assert.equal(msg.tick,0);
    assert.equal(msg.observation.height,0);
    assert.equal(Object.hasOwn(msg,'opponentActions'),false);
    assert.equal(Object.hasOwn(msg,'opponentActionsTick'),false);
    assert.equal(Object.hasOwn(msg,'pickupForecast'),id==='D'||id==='H');
    started.push(id);
    // A serial or staged dispatch cannot satisfy this before its first await.
    await Promise.resolve();
    assert.deepEqual(started,ids);
    if(id==='C') return {error:'timeout'};
    if(id==='B') return {value:{bad:true}};
    return {value:{jump:id==='A'}};
  }}]));
  await runMatch({game,seats,seed:1,maxTicks:1,timeoutMs:250,humanControls:{A:'arrows'},
    privilegedSeats:['D','H'],record:row=>records.push(row)});
  assert.deepEqual(records[0].manifest.inputInsight,{seats:['D','H'],timing:'concurrent',capabilities:['sample']});
  assert.deepEqual(records[1].input.C,{submitted:null,accepted:{jump:false},fallback:'timeout'});
  assert.deepEqual(records[1].input.B,{submitted:{bad:true},accepted:{jump:false},fallback:'invalid_action'});
  assert.deepEqual(records[1].state.heights,{A:1,B:0,C:0,D:0,E:0,F:0,G:0,H:0});
});

test('ordinary-only matches do not compute private hints',async()=>{
  const game={...jumpGame,privilegedObservation(){assert.fail('computed unneeded hints');}};
  const bot={act(_msg,budget){assert.equal(budget,250);return {value:{jump:false}};}};
  await runMatch({game,seats:{A:bot,B:bot},seed:1,maxTicks:1,timeoutMs:250,record:()=>{}});
});

const script=`
  const rl=require('node:readline').createInterface({input:process.stdin});
  rl.on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='start') console.log(JSON.stringify({type:'ready',protocol:1,name:'Laika'}));
    if(msg.type==='observe') console.log(JSON.stringify({
      type:'action',tick:msg.tick,action:{throttle:0,turn:0,fire:['opponentActions','opponentActionsTick','pickupForecast','shrinkDestination'].some(key=>Object.hasOwn(msg,key))}
    }));
  });
`;

async function createFixture(t,registryFolder) {
  const path=await mkdtemp(join(tmpdir(),'arena-insight-'));
  t.after(()=>rm(path,{recursive:true,force:true}));
  for(const folder of ['gpt-dots','laika','fake']){
    const dir=join(path,'bots',folder);
    await mkdir(dir,{recursive:true});
    await writeFile(join(dir,'bot.js'),script);
    if(folder==='laika'&&registryFolder!=='laika'||folder==='fake'&&registryFolder!=='fake') continue;
    const id=folder==='fake'?'laika':folder;
    await writeFile(join(dir,'bot.json'),JSON.stringify({
      schema:1,protocol:1,id,name:'Laika',game:'tank-trouble',entry:'bot.js'
    }));
  }
  return path;
}

async function fetchManifest(t, registryFolder, paths, options={}) {
  const root=await createFixture(t,registryFolder);
  let records=[];
  const match=await makeMatch({game,root,base:join(root,'runs'),seed:1,maxTicks:1,timeoutMs:1000,
    paths,registry:await loadBotRegistry(root,game.id),recorder:()=>({write:row=>records.push(row),close:()=>{}}),
    ...options});
  await match.run();
  assert.deepEqual(records[0].readiness,{A:'ready',B:'ready'});
  assert.equal(records[1].input.A.submitted.fire,false);
  return records[0].manifest;
}

test('only registered builtin Laika or its actual default entry receives the privilege',async t=>{
  const genuine=await fetchManifest(t,'laika',{B:'laika'});
  assert.deepEqual(genuine.inputInsight.seats,['B']);
  assert.equal(genuine.botVersions.B.policy,'laika-insight/6');
  assert.deepEqual(genuine.inputInsight.capabilities,['pickup-forecast']);
  assert.equal(Object.hasOwn(genuine.botVersions.A,'policy'),false);

  const random=await fetchManifest(t,'laika',{B:'laika'},{config:{shrinkCenter:'random'}});
  assert.deepEqual(random.inputInsight,{seats:['B'],timing:'concurrent',capabilities:['pickup-forecast','shrink-destination']});

  const fake=await fetchManifest(t,'fake',{B:'laika'},{config:{shrinkCenter:'random'}});
  assert.equal(Object.hasOwn(fake,'inputInsight'),false);

  const builtinDefault=await fetchManifest(t,'none',{});
  assert.deepEqual(builtinDefault.inputInsight.seats,['B']);

  const nonTank=await fetchManifest(t,'laika',{B:'laika'},{game:{...game,id:'other-fixture'}});
  assert.equal(Object.hasOwn(nonTank,'inputInsight'),false);
});

test('only privileged seats receive the forecast from pre-tick state; replay has no forecast payload',async()=>{
  const records=[];
  const seen=[];
  const neutral=game.neutralAction();
  const seats=Object.fromEntries([...'ABCD'].map(id=>[id,{act(msg){
    seen.push(id);
    assert.equal(Object.hasOwn(msg.observation,'pickupForecast'),false);
    if (id==='A'||id==='B') assert.equal(Object.hasOwn(msg,'pickupForecast'),false);
    else {
      assert.equal(Object.hasOwn(msg,'opponentActions'),false);
      assert.equal(Object.hasOwn(msg,'opponentActionsTick'),false);
      const expected=game.privilegedObservation(records[0].state).pickupForecast;
      assert.deepEqual(msg.pickupForecast,expected);
      msg.pickupForecast.candidate.x=-100;
    }
    return {value:neutral};
  }}]));
  await runMatch({game,seats,seed:7,maxTicks:1,timeoutMs:1000,config:{pickupInterval:1},
    humanControls:{A:'arrows'},privilegedSeats:['C','D'],record:row=>records.push(row)});
  const hinted=game.privilegedObservation(records[0].state).pickupForecast;
  const spawned=records[1].events.find(event=>event.type==='pickup-spawn');
  assert.deepEqual(hinted,{attemptTick:1,ticksUntil:1,candidate:{x:spawned.x,y:spawned.y,type:spawned.pickupType}});
  assert.equal(Object.hasOwn(records[1].input.C,'pickupForecast'),false);
  assert.deepEqual(game.step(records[0].state,Object.fromEntries(seen.map(id=>[id,neutral]))).state,records[1].state);
});

test('forecast is absent during settlement or disabled pickups and omits distant or capped candidates',()=>{
  const input={seed:7,players:['A','B']};
  const state=game.init(input);
  const hint=s=>game.privilegedObservation(s)?.pickupForecast;
  assert.deepEqual(hint(state),{attemptTick:state.nextPickupAt,ticksUntil:state.nextPickupAt});
  const near={...state,roundTick:state.nextPickupAt-1};
  assert.ok(hint(near).candidate);
  const rng=near.rng;
  assert.deepEqual(hint(near),hint(near));
  assert.equal(near.rng,rng);
  assert.equal(hint({...near,pickups:Array(near.profile.crateLimit).fill({x:32,y:32})}).candidate,undefined);
  assert.equal(hint({...near,phase:'intermission'}),undefined);
  assert.equal(hint({...near,settleUntil:40}),undefined);
  assert.equal(hint(game.init({...input,config:{pickups:false}})),undefined);
});

test('the random shrink destination is copied only for authorized seats, with no timing change',async()=>{
  const records=[],started=[];
  const ids=[...'ABCD'];
  const seats=Object.fromEntries(ids.map(id=>[id,{async act(message,budget) {
    const isPrivileged=id==='C'||id==='D';
    assert.equal(budget,250);
    assert.equal(Object.hasOwn(message,'opponentActions'),false);
    assert.equal(Object.hasOwn(message,'shrinkDestination'),isPrivileged);
    assert.equal(Object.hasOwn(message.observation,'zoneDestination'),false);
    assert.equal(Object.hasOwn(message.observation.zone,'finalX'),false);
    if(isPrivileged) {
      assert.deepEqual(message.shrinkDestination,game.privilegedObservation(records[0].state).shrinkDestination);
      message.shrinkDestination.x=-100;
    }
    started.push(id);
    await Promise.resolve();
    assert.deepEqual(started,ids);
    return {value:game.neutralAction()};
  }}]));
  await runMatch({game,seats,seed:7,maxTicks:1,timeoutMs:250,record:row=>records.push(row),
    config:{shrinkCenter:'random',pickups:false},humanControls:{A:'arrows'},privilegedSeats:['C','D']});
  assert.deepEqual(records[0].manifest.inputInsight.capabilities,['pickup-forecast','shrink-destination']);
  assert.ok(!JSON.stringify(records[1].input).includes('shrinkDestination'));
});
