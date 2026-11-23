import assert from 'node:assert/strict';
import test from 'node:test';
import {withLaikaInsight} from '../games/tank-trouble/bots/laika-insight.js';
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

test('an active curved laser can veto a recovery even when its tangent misses',async()=>{
  const seat=wrap(moving);
  for(let tick=0;tick<3;tick++) assert.deepEqual((await seat.act(wallCase(tick))).value,moving);
  const {laserSpeed}=classicProfile(25);
  const curved={kind:'laser',owner:'B',x:195,y:118,heading:Math.PI,curved:true,vx:-laserSpeed,vy:0,ttl:8};
  assert.deepEqual((await seat.act(wallCase(3,{bullets:[curved]}))).value,moving);
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
