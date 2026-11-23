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

test('insight sees validated same-tick ordinary and human actions, and never other privileged actions',async()=>{
  const records=[];
  const ordinaryStarts=new Set();
  const insightStarts=new Set();
  const ordinaryTicks={};
  const seat=(id,fn)=>({act(msg,budget){return fn(msg,budget,id);}});
  const ordinary=(id, action)=>seat(id,async(msg,budget)=>{
    assert.equal(msg.observation.height,0);
    assert.equal(Object.hasOwn(msg,'opponentActions'),false);
    assert.equal(Object.hasOwn(msg,'opponentActionsTick'),false);
    assert.ok(budget>0&&budget<=600);
    ordinaryStarts.add(id);
    await Promise.resolve();
    assert.deepEqual([...ordinaryStarts],['A','B','C']);
    ordinaryTicks[id]=msg.tick;
    return action;
  });
  const insight=(id)=>seat(id,async(msg,budget)=>{
    assert.equal(msg.observation.height,0);
    assert.equal(msg.opponentActionsTick,msg.tick);
    assert.equal(ordinaryTicks.A,msg.tick);
    assert.equal(ordinaryTicks.B,msg.tick);
    assert.equal(ordinaryTicks.C,msg.tick);
    assert.ok(budget>0&&budget<=1000);
    assert.deepEqual(msg.opponentActions,{A:{jump:true},B:{jump:false},C:{jump:false}});
    msg.opponentActions.A.jump=false;
    insightStarts.add(id);
    await Promise.resolve();
    assert.deepEqual([...insightStarts],['D','E']);
    return {value:{jump:false}};
  });
  await runMatch({
    game:jumpGame,seed:1,maxTicks:1,timeoutMs:1000,
    seats:{E:insight('E'),D:insight('D'),C:ordinary('C',{error:'timeout'}),B:ordinary('B',{value:{bad:true}}),
      A:ordinary('A',{value:{jump:true}})},
    humanControls:{A:'arrows'},inputInsightSeats:['E','D'],
    record:row=>records.push(row)
  });
  assert.deepEqual(records[0].manifest.inputInsight,{seats:['D','E'],contract:'accepted-opponent-actions',timing:'same-tick-after-ordinary'});
  assert.deepEqual(records[0].readiness,{A:'ready',B:'ready',C:'ready',D:'ready',E:'ready'});
  assert.deepEqual(records[1].input.C,{submitted:null,accepted:{jump:false},fallback:'timeout'});
  assert.deepEqual(records[1].input.B,{submitted:{bad:true},accepted:{jump:false},fallback:'invalid_action'});
  assert.deepEqual(records[1].state.heights,{A:1,B:0,C:0,D:0,E:0});
  assert.ok(Object.values(records[1].input).every(entry=>!Object.hasOwn(entry,'opponentActions')));
});

test('all-privileged brief is empty, phases share remaining deadline, and stop finishes the in-flight tick',async()=>{
  const empty={act({opponentActions,opponentActionsTick,tick}){
    assert.equal(opponentActionsTick,tick);assert.deepEqual(opponentActions,{});return {value:{jump:false}};
  }};
  await runMatch({game:jumpGame,seats:{A:empty,B:empty},seed:1,maxTicks:1,
    timeoutMs:1000,inputInsightSeats:['B','A'],record:()=>{}});
  const controller=new AbortController();
  const seen=[];
  let ordinaryBudget,insightBudget;
  const result=await runMatch({
    game:jumpGame,seed:1,maxTicks:10,timeoutMs:250,signal:controller.signal,inputInsightSeats:['B'],
    seats:{
      A:{async act(_msg,budget){ordinaryBudget=budget;controller.abort();return {value:{jump:true}};}},
      B:{act(msg,budget){
        insightBudget=budget;
        assert.equal(msg.opponentActionsTick,msg.tick);
        assert.deepEqual(msg.opponentActions,{A:{jump:true}});
        return {value:{jump:false}};
      }}
    },
    record:row=>seen.push(row)
  });
  assert.ok(ordinaryBudget>0&&ordinaryBudget<150);
  assert.ok(insightBudget>0&&insightBudget<250);
  assert.deepEqual(seen.map(row=>row.type),['start','tick','end']);
  assert.deepEqual(result,{winner:null,reason:'stopped'});
});

const script=`
  const rl=require('node:readline').createInterface({input:process.stdin});
  rl.on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='start') console.log(JSON.stringify({type:'ready',protocol:1,name:'Laika'}));
    if(msg.type==='observe') console.log(JSON.stringify({
      type:'action',tick:msg.tick,action:{throttle:0,turn:0,fire:['opponentActions','opponentActionsTick','pickupForecast'].some(key=>Object.hasOwn(msg,key))}
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
  assert.equal(genuine.botVersions.B.policy,'laika-insight/4');
  assert.deepEqual(genuine.inputInsight.capabilities,['pickup-forecast']);
  assert.equal(Object.hasOwn(genuine.botVersions.A,'policy'),false);

  const fake=await fetchManifest(t,'fake',{B:'laika'});
  assert.equal(Object.hasOwn(fake,'inputInsight'),false);

  const builtinDefault=await fetchManifest(t,'none',{});
  assert.deepEqual(builtinDefault.inputInsight.seats,['B']);

  const nonTank=await fetchManifest(t,'laika',{B:'laika'},{game:{...game,id:'other-fixture'}});
  assert.equal(Object.hasOwn(nonTank,'inputInsight'),false);
});

test('only privileged seats receive the forecast after ordinary acts; replay has no forecast payload',async()=>{
  const records=[];
  const seen=[];
  const neutral=game.neutralAction();
  const seats=Object.fromEntries([...'ABCD'].map(id=>[id,{act(msg){
    seen.push(id);
    assert.equal(Object.hasOwn(msg.observation,'pickupForecast'),false);
    if (id==='A'||id==='B') assert.equal(Object.hasOwn(msg,'pickupForecast'),false);
    else {
      assert.deepEqual(seen.slice(0,2),['A','B']);
      assert.deepEqual(Object.keys(msg.opponentActions),['A','B']);
      const expected=game.privilegedObservation(records[0].state).pickupForecast;
      assert.deepEqual(msg.pickupForecast,expected);
      msg.pickupForecast.candidate.x=-100;
    }
    return {value:neutral};
  }}]));
  await runMatch({game,seats,seed:7,maxTicks:1,timeoutMs:1000,config:{pickupInterval:1},
    humanControls:{A:'arrows'},inputInsightSeats:['C','D'],record:row=>records.push(row)});
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
