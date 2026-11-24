import assert from 'node:assert/strict';
import test from 'node:test';
import {createLaikaPolicy} from '../bots/laika/policy.js';
import {withLaikaInsight} from '../games/tank-trouble/bots/laika-insight.js';
import {gameForRate} from '../games/tank-trouble/adapter/index.js';
import {classicProfile} from '../games/tank-trouble/engine/profile.js';

const neutral={throttle:0,turn:0,fire:false};
const moving={...neutral,throttle:1};
const shooting={...neutral,fire:true};
const tank=(id,x,y,angle,props={})=>({id,x,y,angle,alive:true,weapon:null,...props});
function observe(B,overrides={}) {
  return {type:'observe',tick:17,observation:{tick:17,roundTick:8,phase:'playing',
    width:256,height:256,playerId:'A',tanks:[tank('A',64,64,0),B],walls:[],bullets:[],profile:classicProfile(25),...overrides}};
}
function wrap(action=neutral) {
  return withLaikaInsight({act:async()=>({value:action,error:null})});
}

test('ordinary bot call receives untouched common tick and no forecast metadata',async()=>{
  const b=tank('B',124,82,-Math.PI/2), original=observe(b);
  original.pickupForecast={attemptTick:16,ticksUntil:8,candidate:{x:160,y:96,type:'laser'}};
  let opened=false,closed=false;
  const originalResponse={error:'timeout',value:null};
  const seat=withLaikaInsight({
    start(message) {assert.equal(message.type,'start');opened=true;},
    act(message,budget) {
      assert.equal(message.tick,17);
      assert.equal(message.observation,original.observation);
      assert.equal(message.pickupForecast,undefined);
      assert.ok(budget<=50);
      return originalResponse;
    },
    close() {closed=true;}
  });
  seat.start({type:'start'});
  assert.equal(await seat.act(original,50),originalResponse);
  seat.close();
  assert.ok(opened&&closed);
});

function wallCase(tick,overrides={}) {
  const b=tank('B',230,230,0);
  return {...observe(b),tick,
    observation:{...observe(b).observation,tick,roundTick:tick,round:1,
      walls:[{x1:64,y1:0,x2:64,y2:128}],tanks:[tank('A',76.25,96,Math.PI),b],...overrides}};
}

test('recover with legal reverse after repeated real wall blocks, then resume after progress',async()=>{
  const seat=wrap(moving);
  for(let tick=0;tick<3;tick++) assert.deepEqual((await seat.act(wallCase(tick))).value,moving);
  assert.deepEqual((await seat.act(wallCase(3))).value,{...neutral,throttle:-1});
  const b=tank('B',230,230,0), clear=tank('A',88.75,96,Math.PI);
  assert.deepEqual((await seat.act(wallCase(4,{tanks:[clear,b]}))).value,moving);
});

test('idle, solitary wall contact, round changes and live nearby hazards do not trigger recovery',async()=>{
  const idle=wrap();
  for(let tick=0;tick<7;tick++) assert.deepEqual((await idle.act(wallCase(tick))).value,neutral);
  const seat=wrap(moving), b=tank('B',230,230,0), clear=tank('A',92,96,Math.PI);
  assert.deepEqual((await seat.act(wallCase(0))).value,moving);
  assert.deepEqual((await seat.act(wallCase(1,{tanks:[clear,b]}))).value,moving);
  for(let tick=2;tick<5;tick++) assert.deepEqual((await seat.act(wallCase(tick))).value,moving);
  const bullet={kind:'shell',owner:'B',x:93,y:96,vx:-3,vy:0};
  assert.deepEqual((await seat.act(wallCase(5,{bullets:[bullet]}))).value,moving);
  assert.deepEqual((await seat.act(wallCase(6,{round:2,roundTick:0}))).value,moving);
});

test('a passing shell does not keep the bot stuck in a wall',async()=>{
  const seat=wrap(moving);
  const passing={kind:'shell',owner:'A',ownerArmed:true,x:98,y:98,vx:5,vy:0};
  for(let tick=0;tick<3;tick++) {
    assert.deepEqual((await seat.act(wallCase(tick,{bullets:[passing]}))).value,moving);
  }
  assert.deepEqual((await seat.act(wallCase(3,{bullets:[passing]}))).value,{...neutral,throttle:-1});
});

test('a reflected laser can veto recovery even when initially moving away',async()=>{
  const seat=wrap(moving);
  for(let tick=0;tick<3;tick++) assert.deepEqual((await seat.act(wallCase(tick))).value,moving);
  const {laserSpeed}=classicProfile(25);
  const reflected={kind:'laser',owner:'B',x:103,y:96,heading:0,vx:laserSpeed,vy:0,ttl:8};
  const walls=[...wallCase(3).observation.walls,{x1:128,y1:0,x2:128,y2:128}];
  assert.deepEqual((await seat.act(wallCase(3,{bullets:[reflected],walls}))).value,moving);
});

function crateCase(me=tank('A',106,96,0),ticksUntil=40,overrides={}) {
  return {...observe(null,{tanks:[me,tank('B',228,228,0)],...overrides}),
    pickupForecast:{attemptTick:8+ticksUntil,ticksUntil,candidate:{x:160,y:96,type:'laser'}}};
}

test('a near forecast stages an empty hull for up to two seconds, without blocking the spawn',async()=>{
  assert.deepEqual((await wrap().act(crateCase())).value,moving);
  const atStage=tank('A',126,96,0);
  assert.deepEqual((await wrap(moving).act(crateCase(atStage,5))).value,neutral);
  const beforeStage=tank('A',121,96,0);
  const command=(await wrap().act(crateCase(beforeStage,8))).value;
  assert.deepEqual(command,moving);
  assert.ok(160-(beforeStage.x+classicProfile(25).forwardSpeed)>=30);
  assert.deepEqual((await wrap().act(crateCase(undefined,51))).value,neutral);
  const missing=crateCase();
  delete missing.pickupForecast.candidate;
  assert.deepEqual((await wrap().act(missing)).value,neutral);
  const stale=crateCase();
  stale.pickupForecast.attemptTick--;
  assert.deepEqual((await wrap().act(stale)).value,neutral);
  assert.deepEqual((await wrap().act(crateCase(undefined,40,{phase:'intermission'}))).value,neutral);
});

test('a forecast yields to current combat, a closed route, or an observable crate',async()=>{
  const me=tank('A',106,96,0),closeEnemy=tank('B',156,140,0);
  assert.deepEqual((await wrap(shooting).act(crateCase(me))).value,shooting);
  assert.deepEqual((await wrap().act(crateCase({...me,weapon:'laser'}))).value,neutral);
  assert.deepEqual((await wrap().act(crateCase(me,40,{tanks:[me,closeEnemy]}))).value,neutral);
  assert.deepEqual((await wrap().act(crateCase(me,40,{walls:[{x1:128,y1:0,x2:128,y2:256}]}))).value,neutral);
  const shell={kind:'shell',owner:'B',x:124,y:96,vx:-3,vy:0};
  assert.deepEqual((await wrap().act(crateCase(me,40,{bullets:[shell]}))).value,neutral);
  assert.deepEqual((await wrap().act(crateCase(me,40,{pickups:[{x:96,y:96,type:'mine'}]}))).value,neutral);
});

test('ordinary visible enemy poses alone do not introduce tactical shot overrides',async()=>{
  const b=tank('B',100,64,0);
  assert.deepEqual((await wrap().act(observe(b))).value,neutral);
  assert.deepEqual((await wrap(shooting).act(observe(b))).value,shooting);
});


test('wrapped Laika reverses away from a wall only when the retreat is clear',async()=>{
  const profile=classicProfile(60);
  const makeSeat=()=>{
    const decide=createLaikaPolicy();
    return withLaikaInsight({act:async ({observation})=>({value:decide(observation),error:null})});
  };
  const me=tank('A',76.25,96,Math.PI),target=tank('B',228,200,0);
  const blocked=makeSeat(),clear=makeSeat();
  for(let tick=0;tick<7;tick++) {
    const shell={id:'b',kind:'shell',owner:'B',y:96,vy:0,ttl:100};
    const input=(x,vx)=>wallCase(tick,{
      profile,tanks:[me,target],pickups:[{x:96,y:96}],
      bullets:[{...shell,x,vx}]
    });
    assert.deepEqual((await clear.act(input(53,2.4))).value,{...neutral,throttle:-1});
    assert.equal((await blocked.act(input(94,-2.4))).value.throttle,0);
  }
});

test('Laika routes around a wall when nearing shrink but does not share the destination with the base process',async()=>{
  const me=tank('A',96,96,Math.PI/2),other=tank('B',232,232,0);
  const walls=[{x1:128,y1:64,x2:128,y2:128}];
  const input={...observe(other,{tanks:[me,other],walls,round:1,
    zone:{x:96,y:96,halfWidth:160,halfHeight:160,finalHalfWidth:24,finalHalfHeight:24,startTick:120,endTick:200}}),
    shrinkDestination:{x:160,y:96,startsAt:120,endsAt:200}};
  const seat=withLaikaInsight({act(message) {
    assert.equal(message.shrinkDestination,undefined);
    return {value:neutral};
  }});
  assert.deepEqual((await seat.act(input)).value,{...neutral,throttle:-1});
  assert.deepEqual((await wrap(shooting).act(input)).value,shooting);
  const far={...input,observation:{...input.observation,zone:{...input.observation.zone,startTick:1000,endTick:1100}},
    shrinkDestination:{...input.shrinkDestination,startsAt:1000,endsAt:1100}};
  assert.deepEqual((await wrap().act(far)).value,neutral);
  assert.deepEqual((await wrap().act({...input,shrinkDestination:{...input.shrinkDestination,startsAt:121}})).value,neutral);
});


test('a neutral Laika can reach the random destination before movement of the safe zone begins',async()=>{
  const game=gameForRate(25), seat=wrap();
  let state=game.init({seed:42,config:{shrinkCenter:'random',shrinkAfterSeconds:20,pickups:false},players:['A','B']});
  const start=state.tanks[0],destination=state.zoneDestination;
  const distance=t=>Math.hypot(t.x-destination.x,t.y-destination.y);
  assert.ok(distance(start)>200);
  for(let tick=0;tick<state.zone.startTick;tick++) {
    const observation=game.observe(state,'A');
    const a=(await seat.act({tick,observation,...game.privilegedObservation(state)})).value;
    const advanced=game.step(state,{A:a,B:neutral});
    assert.ok(!advanced.events.some(event=>event.type==='wall-stop'&&event.tankId==='A'));
    state=advanced.state;
  }
  assert.ok(distance(state.tanks[0])<8);
});
