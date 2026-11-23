import assert from 'node:assert/strict';
import {test} from 'node:test';
import {game,gameV7,gameV8_25,gameV8_30,gameV8_60} from '../adapter/index.js';
import {PICKUP_TYPES_V8,stepV8} from './classic.js';

const variants=[gameV8_25,gameV8_30,gameV8_60];
const players=['A','B'];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} should be ${b}`);
const neutral={throttle:0,turn:0,fire:false};

test('v8 chooses true rate-specific profiles and equal wall-time movement and turning',()=>{
  assert.equal(game,gameV8_25);
  const seed=44;
  for(const g of variants){
    const hz=g.tickRate;
    assert.equal(g.version,'8-'+hz);
    const base=g.init({seed,players,config:{pickups:false}});
    assert.equal(base.config.maxTicks,60*hz);
    assert.equal(base.shellLimit,10);
    near(base.config.shellSpeed*hz,144);
    assert.equal(base.profile.shellTtl,10*hz);
    assert.equal(base.zone.startTick,40*hz);
    assert.equal(base.zone.endTick,55*hz);
    assert.equal(base.zone.graceTicks,2*hz);
    const fresh=()=>({...base,walls:[],tanks:base.tanks.map(t=>({...t,x:t.id==='A'?300:700,y:100,angle:0}))});
    for(const [action,dx,angle] of [
      [{...neutral,throttle:1},128,0],
      [{...neutral,throttle:-1},-80,0],
      [{...neutral,turn:1},0,250*Math.PI/180]
    ]){
      let state=fresh();
      for(let i=0;i<hz;i++) state=g.step(state,{A:action}).state;
      near(state.tanks[0].x,300+dx); near(state.tanks[0].angle,angle);
    }
    const obs=g.observe(base,'A'); obs.profile.turnSpeed=0;
    assert.notEqual(base.profile.turnSpeed,0);
  }
  assert.equal(gameV7.tickRate,60);
  assert.equal(gameV7.version,'7');
});

test('v8 config scales round, team settlement, intermission and series upper limits',()=>{
  for(const g of variants){
    const hz=g.tickRate;
    const config={shrinkAfterSeconds:90,shrinkDurationSeconds:20,pickups:false,roundLimit:2};
    const fresh=g.init({seed:44,players,config});
    assert.equal(fresh.zone.startTick,90*hz);
    assert.equal(fresh.zone.endTick,110*hz);
    assert.equal(fresh.config.maxTicks,115*hz);
    assert.equal(g.matchTickLimit(config),2*(115+3)*hz+hz);
    let state={...fresh,tanks:fresh.tanks.map(t=>({...t,alive:t.id==='A'}))};
    const pending=g.step(state,{}).state;
    assert.equal(pending.settleUntil,1+3*hz);
    assert.equal(pending.tanks[0].invulnerable,true);
    state=pending;
    for(let i=0;i<3*hz;i++) state=g.step(state,{}).state;
    assert.equal(state.phase,'intermission');
    assert.equal(state.intermission,hz);
    for(let i=0;i<hz;i++)state=g.step(state,{}).state;
    assert.equal(state.round,2);
    assert.equal(state.roundTick,0);
  }
});

test('v8 first Classic crate attempt is age 350..549 source frames at every rate',()=>{
  for(const g of variants){
    const hz=g.tickRate;
    const state=g.init({seed:44,players});
    assert.equal(state.nextPickupAt,g.init({seed:44,players}).nextPickupAt);
    assert(state.nextPickupAt>=Math.ceil(350*hz/25));
    assert(state.nextPickupAt<=Math.ceil(549*hz/25));
    const before=stepV8({...state,tick:state.nextPickupAt-2},{}).state;
    assert.equal(before.pickups.length,0);
    const attempt=stepV8(before,{});
    assert.equal(attempt.state.pickups.length,1);
    const item=attempt.events.find(e=>e.type==='pickup-spawn');
    assert(PICKUP_TYPES_V8.includes(item.pickupType));
    const cells=state.config.cols*state.config.rows;
    const delay=attempt.state.nextPickupAt-attempt.state.tick;
    assert(delay>=Math.ceil(Math.ceil(350+2000/cells)*hz/25));
    assert(delay<=Math.ceil(Math.ceil(549+2000/cells)*hz/25));
  }
});

test('v8 honors exact pickup interval and shell speed overrides, reschedules at cap, and quick solo only gets laser',()=>{
  const g=gameV8_60;
  let state=g.init({seed:72,players,config:{pickupInterval:1,shellSpeed:4.2,classicSolo:true}});
  near(state.profile.shellSpeed,4.2);
  assert.equal(state.nextPickupAt,1);
  const items=[];
  for(let i=0;i<5;i++){
    const r=stepV8(state,{});
    state=r.state;
    items.push(...r.events.filter(e=>e.type==='pickup-spawn'));
    assert.equal(state.nextPickupAt,state.tick+1);
  }
  assert.equal(items.length,3);
  assert(items.every(e=>e.pickupType==='laser'));
  assert.equal(state.pickups.length,3);
  const active=g.init({seed:17,players,config:{pickupInterval:1}});
  const survivor={...active,tanks:active.tanks.map(t=>({...t,alive:t.id==='A'}))};
  const after=stepV8(survivor,{});
  assert.equal(after.state.pickups.length,0);
  assert.equal(after.state.nextPickupAt,1);
});

test('all seven standard v8 crate categories are reachable in seeded normal play',()=>{
  const kinds=new Set();
  for(let seed=0;seed<100;seed++){
    const start=gameV8_25.init({seed,players,config:{pickupInterval:1}});
    const step=stepV8(start,{});
    kinds.add(step.events.find(e=>e.type==='pickup-spawn')?.pickupType);
  }
  assert.deepEqual([...kinds].sort(),[...PICKUP_TYPES_V8].sort());
});
