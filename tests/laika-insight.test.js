import assert from 'node:assert/strict';
import test from 'node:test';
import {withLaikaInsight} from '../games/tank-trouble/bots/laika-insight.js';
import {classicProfile} from '../games/tank-trouble/engine/profile.js';

const neutral={throttle:0,turn:0,fire:false};
const moving={...neutral,throttle:1};
const shooting={...neutral,fire:true};
const tank=(id,x,y,angle,props={})=>({id,x,y,angle,alive:true,weapon:null,...props});
function observe(commands,B,overrides={}) {
  return {type:'observe',tick:17,opponentActions:commands,opponentActionsTick:17,observation:{tick:17,roundTick:8,phase:'playing',
    width:256,height:256,playerId:'A',tanks:[tank('A',64,64,0),B],walls:[],bullets:[],profile:classicProfile(25),...overrides}};
}
function wrap(action=neutral) {
  return withLaikaInsight({act:async()=>({value:action,error:null})});
}

test('accepted same-tick movement can expose a short clear firing line',async()=>{
  const b=tank('B',124,82,-Math.PI/2);
  const seat=wrap();
  assert.deepEqual((await seat.act(observe({B:neutral},b))).value,neutral);
  assert.deepEqual((await seat.act(observe({B:moving},b))).value,shooting);
  assert.deepEqual((await seat.act(observe({B:moving},b,{walls:[{x1:96,y1:0,x2:96,y2:128}]}))).value,neutral);
  assert.deepEqual((await seat.act(observe({B:moving},b,{teams:{A:'1',B:'1'},friendlyFire:true}))).value,neutral);
});

test('the same base shot can be released when accepted movement leaves the firing line',async()=>{
  const b=tank('B',132,76,Math.PI/2);
  const seat=wrap(shooting);
  assert.deepEqual((await seat.act(observe({B:neutral},b))).value,shooting);
  assert.deepEqual((await seat.act(observe({B:moving},b))).value,neutral);
  // A held button is not interpreted as a new shot by the overlay.
  const held=tank('A',64,64,0,{fireHeld:true});
  assert.deepEqual((await seat.act(observe({B:moving},b,{tanks:[held,b]}))).value,shooting);
});

test('fresh enemy fire triggers a safe dodge; held fire and protected allies do not',async()=>{
  const a=tank('A',64,64,Math.PI/2), seat=wrap(moving);
  for(const b of [tank('B',118,77,Math.PI,{weapon:'laser'}),tank('B',105,80,Math.PI)]) {
    const layout={tanks:[a,b]};
    assert.deepEqual((await seat.act(observe({B:neutral},b,layout))).value,moving);
    assert.deepEqual((await seat.act(observe({B:shooting},b,layout))).value,neutral);
    assert.deepEqual((await seat.act(observe({B:shooting},b,{tanks:[a,{...b,fireHeld:true}]}))).value,moving);
    const teams={A:'1',B:'1'};
    assert.deepEqual((await seat.act(observe({B:shooting},b,{...layout,teams,friendlyFire:false}))).value,moving);
    assert.deepEqual((await seat.act(observe({B:shooting},b,{...layout,teams,friendlyFire:true}))).value,neutral);
    assert.deepEqual((await seat.act(observe({B:shooting},b,{...layout,
      walls:[{x1:84,y1:0,x2:84,y2:128}]}))).value,b.weapon==='laser'?neutral:moving);
  }
});

test('takes very short clear shots only when safe, fresh, and below the shell cap',async()=>{
  const b=tank('B',100,64,0), seat=wrap();
  assert.deepEqual((await seat.act(observe({B:neutral},b))).value,shooting);
  const a=tank('A',64,64,0);
  assert.deepEqual((await seat.act(observe({B:neutral},b,{tanks:[{...a,fireHeld:true},b]}))).value,neutral);
  const {shellLimit}=classicProfile(25);
  const bullets=Array.from({length:shellLimit},()=>({kind:'shell',owner:'A',x:240,y:240,vx:1,vy:0}));
  assert.deepEqual((await seat.act(observe({B:neutral},b,{bullets}))).value,neutral);
  const incoming={kind:'shell',owner:'B',x:85,y:64,vx:-5,vy:0};
  assert.deepEqual((await seat.act(observe({B:neutral},b,{bullets:[incoming]}))).value,neutral);
  assert.deepEqual((await seat.act(observe({},b))).value,neutral);
});

test('the overlay honors tick zero but refuses delayed, missing, or inactive inputs',async()=>{
  const b=tank('B',124,82,-Math.PI/2), msg=observe({B:moving},b), seat=wrap();
  for(const opponentActionsTick of [null,15,16,18,undefined]) {
    assert.deepEqual((await seat.act({...msg,opponentActionsTick})).value,neutral);
  }
  assert.deepEqual((await seat.act({...msg,tick:0,opponentActionsTick:0,
    observation:{...msg.observation,tick:0,roundTick:0}})).value,shooting);
  for(const phase of ['intermission','finished']) {
    assert.deepEqual((await seat.act({...msg,observation:{...msg.observation,phase}})).value,neutral);
  }
});

test('ordinary bot call receives untouched common tick and no read-input metadata',async()=>{
  const b=tank('B',124,82,-Math.PI/2), original=observe({B:moving},b);
  original.pickupForecast={attemptTick:16,ticksUntil:8,candidate:{x:160,y:96,type:'laser'}};
  let opened=false,closed=false;
  const originalResponse={error:'timeout',value:null};
  const seat=withLaikaInsight({
    start(message) {assert.equal(message.type,'start');opened=true;},
    act(message,budget) {
      assert.equal(message.tick,17);
      assert.equal(message.observation,original.observation);
      assert.equal(message.opponentActions,undefined);
      assert.equal(message.opponentActionsTick,undefined);
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
  return {...observe({B:neutral},b),tick,opponentActionsTick:tick,
    observation:{...observe({B:neutral},b).observation,tick,roundTick:tick,round:1,
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
  return {...observe({},null,{tanks:[me,tank('B',228,228,0)],...overrides}),
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
