import assert from 'node:assert/strict';
import {test} from 'node:test';
import {init,step} from './classic.js';

function fixture(rate=25) {
  const s=init({seed:'weapon-v8',players:['A','B','C'],config:{cols:16,rows:12,
    shrinkAfterSeconds:120,pickups:false}},rate);
  s.walls=[];
  Object.assign(s.tanks[0],{x:70,y:100,angle:0});
  Object.assign(s.tanks[1],{x:750,y:650,angle:0});
  Object.assign(s.tanks[2],{x:650,y:700,angle:0});
  return s;
}

const action=(fire=false,turn=0,throttle=0)=>({fire,turn,throttle});
const doN=(state,n,input={})=>{
  let r;
  for(let i=0;i<n;i++){r=step(state,input);state=r.state;}
  return r;
};
const equip=(s,weapon,weaponAmmo=1)=>Object.assign(s.tanks[0],{weapon,weaponAmmo});

test('ordinary shells are edge-triggered, 144 px/s, ten seconds and capped at ten',()=>{
  for (const hz of [25,30,60]) {
    const s=fixture(hz);
    let r=step(s,{A:action(true)});
    assert.equal(r.state.bullets[0].vx,144/hz);
    assert.equal(r.state.bullets[0].ttl,10*hz-1);
    assert.equal(r.state.tanks[0].cooldown,0);
    r=doN(r.state,3,{A:action(true)});
    assert.equal(r.state.bullets.length,1);
    for(let i=0;i<9;i++) r=step(step(r.state,{A:action()}).state,{A:action(true)});
    assert.equal(r.state.bullets.length,10);
    r=step(step(r.state,{}).state,{A:action(true)});
    assert.deepEqual(r.events.filter(e=>e.type==='shot-blocked').map(e=>e.reason),['shell-limit']);
  }
});

test('held gatling uses 20 rounds with 30 Hz cadence kept cumulative',()=>{
  const s=fixture(30);
  equip(s,'gatling',20);
  let r=step(s,{A:action(true)}),shotTimes=[];
  assert.equal(r.events[0].type,'weapon-charge');
  for(let i=1;i<90;i++){
    r=step(r.state,{A:action(true)});
    for(const e of r.events) if(e.type==='shot') {
      shotTimes.push(r.state.tick);
      assert.ok(Math.abs(Math.hypot(e.vx,e.vy)-176/30)<1e-12);
      assert.ok(Math.abs(Math.atan2(e.vy,e.vx))<=5.5*Math.PI/180);
    }
  }
  assert.equal(shotTimes[0],12);
  assert.equal(shotTimes.length,20);
  assert.equal(shotTimes.at(-1),Math.ceil(12+19*3.6));
  assert.equal(r.state.tanks[0].weaponAmmo,0);
  assert.equal(r.state.bullets[0].ttl,150-(90-12+1));
  assert.equal(r.state.tanks[0].spinDownUntil,undefined);
  assert.ok(r.state.tanks[0].weapon==='gatling');
  assert.equal(doN(r.state,60).state.tanks[0].weapon,null);
});

test('releasing gatling cancels an incomplete burst and requires spin-down before normal fire',()=>{
  const s=fixture(25);
  equip(s,'gatling',20);
  let r=doN(s,10,{A:action(true)});
  assert.equal(r.state.bullets.length,1);
  r=step(r.state,{A:action(false)});
  assert.equal(r.state.tanks[0].weaponAmmo,0);
  assert.equal(r.state.tanks[0].spinDownUntil,56);
  r=doN(r.state,44,{A:action(true)});
  assert.equal(r.state.tanks[0].weapon,'gatling');
  assert.equal(r.state.bullets.length,1);
  r=step(r.state,{A:action(true)});
  assert.equal(r.state.tanks[0].weapon,null);
  r=step(step(r.state,{}).state,{A:action(true)});
  assert.ok(r.state.bullets.some(b=>b.kind==='shell'));
});

test('laser moves and lasts 0.32s with fractional final advance; may bounce back into owner',()=>{
  for(const hz of [25,30,60]) {
    const s=fixture(hz);
    equip(s,'laser');
    let r=step(s,{A:action(true)});
    assert.equal(r.state.bullets[0].kind,'laser');
    assert.ok(Math.abs(r.state.bullets[0].x-(70+2240/hz))<1e-9);
    assert.equal(r.events.find(e=>e.type==='weapon-fired').moving,true);
    r=doN(r.state,Math.ceil(0.32*hz)-1);
    const expired=r.events.find(e=>e.type==='shell-expired');
    assert.ok(Math.abs(expired.x-(70+2240*0.32))<1e-8);
    assert.equal(r.state.bullets.length,0);
  }
  const ricochet=fixture(25);
  ricochet.walls=[{x1:100,y1:64,x2:100,y2:160}];
  equip(ricochet,'laser');
  const r=step(ricochet,{A:action(true)});
  assert.equal(r.state.tanks[0].alive,false);
  assert.ok(r.events.some(e=>e.type==='bounce'));
});

test('Death Ray autocompletes charge through walls and remains active for 1.2 seconds',()=>{
  const s=fixture(25);
  Object.assign(s.tanks[1],{x:330,y:100});
  s.walls=[{x1:220,y1:64,x2:220,y2:160}];
  equip(s,'death-ray');
  let r=step(s,{A:action(true)});
  r=doN(r.state,13,{A:action(false,1,1)});
  assert.equal(r.state.tanks[0].x,70);
  assert.equal(r.state.tanks[1].alive,true);
  r=step(r.state,{});
  assert.equal(r.state.tick,15);
  assert.equal(r.state.tanks[1].alive,false);
  assert.equal(r.events.find(e=>e.type==='weapon-fired').continuous,true);
  assert.equal(r.state.tanks[0].beamUntil,45);
  r=doN(r.state,29);
  assert.equal(r.events.find(e=>e.type==='death-ray-beam')?.weapon,'death-ray');
  r=step(r.state,{});
  assert.equal(r.state.tanks[0].weapon,null);
  assert.equal(r.events.some(e=>e.type==='death-ray-beam'),false);
});

test('frag detonates on a new press into 40 fragments that cannot bounce',()=>{
  const s=fixture(25);
  s.walls=[{x1:94,y1:64,x2:94,y2:160}];
  equip(s,'frag');
  let r=step(s,{A:action(true)});
  r=step(r.state,{A:action(true)});
  assert.equal(r.state.bullets[0].kind,'frag');
  r=step(step(r.state,{}).state,{A:action(true)});
  assert.equal(r.events.filter(e=>e.type==='shot'&&e.kind==='shrapnel').length,40);
  assert.ok(r.state.bullets.every(b=>b.kind==='shrapnel'&&b.sourceId==='b1'));
  r=step(r.state,{});
  assert.ok(r.events.some(e=>e.kind==='shrapnel'&&e.reason==='wall'));
  assert.equal(r.events.some(e=>e.type==='bounce'),false);
});

test('mine arms for 0.8s, visibly triggers, and waits its separate 0.24s fuse',()=>{
  const s=fixture(25);
  equip(s,'mine',3);
  let r=step(s,{A:action(true)});
  assert.equal(r.state.tanks[0].weaponAmmo,2);
  assert.equal(r.state.mines[0].armedAt,21);
  Object.assign(r.state.tanks[1],{x:r.state.mines[0].x-10,y:r.state.mines[0].y});
  r=doN(r.state,19);
  assert.equal(r.state.mines[0].triggeredAt,null);
  r=step(r.state,{});
  assert.equal(r.events[0].type,'mine-trigger');
  assert.equal(r.state.mines[0].detonateAt,27);
  r=doN(r.state,5);
  assert.equal(r.state.mines.length,1);
  r=step(r.state,{});
  assert.equal(r.events.filter(e=>e.type==='shot'&&e.sourceId==='m1').length,40);
  assert.equal(r.state.mines.length,0);
});

test('homing starts after two seconds; remote turns independently and suppresses hull movement',()=>{
  const homing=fixture(25);
  equip(homing,'missile');
  let r=step(homing,{A:action(true)});
  r=doN(r.state,49);
  assert.equal(r.state.bullets[0].targetId,null);
  assert.equal(r.state.bullets[0].vy,0);
  r=step(r.state,{});
  assert.equal(r.state.bullets[0].targetId,'A');
  assert.ok(r.state.bullets[0].vy!==0);
  const remote=fixture(25);
  equip(remote,'remote');
  r=step(remote,{A:action(true)});
  r=step(r.state,{A:action(false,1,1)});
  assert.equal(r.state.tanks[0].x,70);
  assert.equal(r.state.tanks[0].angle,0);
  const b=r.state.bullets[0];
  assert.equal(b.kind,'remote');
  assert.ok(Math.abs(Math.atan2(b.vy,b.vx)-375*Math.PI/180/25)<1e-12);
});
