import assert from 'node:assert/strict';
import {test} from 'node:test';
import {init,step} from './classic.js';
import {gameForRate} from '../adapter/index.js';

function fixture(rate=25) {
  const s=init({seed:'weapons',players:['A','B','C'],config:{cols:16,rows:12,
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

test('held Gatling fires 20 deterministic three-pellet bursts at the cumulative 30 Hz cadence',()=>{
  const s=fixture(30);
  equip(s,'gatling',20);
  let r=step(s,{A:action(true)}),shotTimes=[];
  assert.equal(r.events[0].type,'weapon-charge');
  for(let i=1;i<90;i++){
    r=step(r.state,{A:action(true)});
    const shots=r.events.filter(e=>e.type==='shot');
    if(!shots.length) continue;
    shotTimes.push(r.state.tick);
    assert.equal(shots.length,3);
    const angles=shots.map(e=>Math.atan2(e.vy,e.vx));
    assert.ok(angles[0]<-Math.PI/30&&Math.abs(angles[1])<Math.PI/30&&angles[2]>Math.PI/30);
    for(const e of shots) {
      assert.ok(Math.abs(Math.hypot(e.vx,e.vy)-176/30)<1e-12);
      assert.ok(Math.abs(Math.atan2(e.vy,e.vx))<=18*Math.PI/180);
    }
  }
  assert.equal(shotTimes[0],12);
  assert.equal(shotTimes.length,20);
  assert.equal(shotTimes.at(-1),Math.ceil(12+19*3.6));
  assert.equal(r.state.tanks[0].weaponAmmo,0);
  assert.ok(r.state.bullets.every(b=>b.ttl<54));
  assert.equal(r.state.tanks[0].spinDownUntil,undefined);
  assert.ok(r.state.tanks[0].weapon==='gatling');
  assert.equal(doN(r.state,60).state.tanks[0].weapon,null);
});

test('Gatling pellets and fragments use their own narrower hit radii',()=>{
  const s=fixture();
  Object.assign(s.tanks[1],{x:100,y:114});
  const shell=kind=>({id:'b1',owner:'A',x:80,y:100,vx:25,vy:0,ttl:5,kind,ownerArmed:false});
  assert.equal(s.profile.gatlingRadius,1.35);
  assert.equal(s.profile.fragmentRadius,2.1);
  assert.equal(step({...s,bullets:[shell('gatling')]},{}).state.tanks[1].alive,true);
  assert.equal(step({...s,bullets:[shell('shell')]},{}).state.tanks[1].alive,false);
  Object.assign(s.tanks[1],{y:114.5});
  assert.equal(step({...s,bullets:[shell('shrapnel')]},{}).state.tanks[1].alive,true);
});

test('releasing gatling cancels an incomplete burst and requires spin-down before normal fire',()=>{
  const s=fixture(25);
  equip(s,'gatling',20);
  let r=doN(s,10,{A:action(true)});
  assert.equal(r.state.bullets.length,3);
  r=step(r.state,{A:action(false)});
  assert.equal(r.state.tanks[0].weaponAmmo,0);
  assert.equal(r.state.tanks[0].spinDownUntil,56);
  r=doN(r.state,44,{A:action(true)});
  assert.equal(r.state.tanks[0].weapon,'gatling');
  assert.equal(r.state.bullets.length,0);
  r=step(r.state,{A:action(true)});
  assert.equal(r.state.tanks[0].weapon,null);
  r=step(step(r.state,{}).state,{A:action(true)});
  assert.ok(r.state.bullets.some(b=>b.kind==='shell'));
});

const curvePoint=(distance,wallDepth=20)=>({
  x:70+wallDepth+2240/Math.PI*Math.sin(Math.PI*(distance-wallDepth)/2240),
  y:100+2240/Math.PI*(1-Math.cos(Math.PI*(distance-wallDepth)/2240))
});

test('laser curves through internal walls for 0.32s at each rate including fractional final advance',()=>{
  for(const hz of [25,30,60]) {
    const s=fixture(hz);
    s.walls=[{x1:90,y1:32,x2:90,y2:500}];
    equip(s,'laser');
    const guide=step(s,{}).state.tanks[0].aimGuide;
    assert.ok(guide.at(-1).x>90&&guide.at(-1).y>100);
    let r=step(s,{A:action(true)});
    const b=r.state.bullets[0], expected=curvePoint(2240/hz);
    assert.equal(b.kind,'laser');
    assert.equal(b.curved,true);
    assert.ok(Math.abs(b.x-expected.x)<1e-8);
    assert.ok(Math.abs(b.y-expected.y)<1e-8);
    assert.deepEqual(r.events.find(e=>e.type==='laser-path').path,b.path);
    assert.ok(!r.events.some(e=>e.type==='bounce'));
    const observed=gameForRate(hz).observe(r.state,'A');
    observed.bullets[0].path[0].x=999;
    assert.equal(b.path[0].x,70);
    assert.equal(r.events.find(e=>e.type==='weapon-fired').moving,true);
    r=doN(r.state,Math.ceil(0.32*hz)-1);
    const expired=r.events.find(e=>e.type==='shell-expired');
    const endpoint=curvePoint(2240*0.32);
    assert.equal(expired.reason,'ttl');
    assert.ok(Math.abs(expired.x-endpoint.x)<1e-8);
    assert.ok(Math.abs(expired.y-endpoint.y)<1e-8);
    assert.equal(r.state.bullets.length,0);
  }
});

test('laser only starts to curve after piercing a wall',()=>{
  const s=fixture(60);
  s.walls=[{x1:140,y1:64,x2:140,y2:170}];
  equip(s,'laser');
  let r=step(s,{A:action(true)});
  assert.equal(r.state.bullets[0].curved,false);
  assert.equal(r.state.bullets[0].y,100);
  r=step(r.state,{});
  const path=r.events.find(e=>e.type==='laser-path').path;
  assert.ok(path.some(p=>Math.abs(p.x-140)<1e-12&&p.y===100));
  assert.equal(r.state.bullets[0].curved,true);
  assert.ok(r.state.bullets[0].y>100);
});

test('laser segments hit the curved target behind a wall and stop at the arena perimeter',()=>{
  const s=fixture(25);
  s.walls=[{x1:100,y1:64,x2:100,y2:170}];
  Object.assign(s.tanks[1],curvePoint(220,30));
  equip(s,'laser');
  let r=step(s,{A:action(true)});
  assert.equal(r.state.tanks[0].alive,true);
  assert.equal(r.state.tanks[1].alive,true);
  r=doN(r.state,2);
  const hit=r.events.find(e=>e.type==='hit'), trace=r.events.find(e=>e.type==='laser-path');
  assert.equal(hit.tankId,'B');
  assert.equal(hit.bulletId,trace.bulletId);
  assert.deepEqual(trace.path.at(-1),{x:hit.x,y:hit.y});
  assert.equal(r.state.tanks[1].alive,false);
  assert.equal(r.state.bullets.length,0);
  const boundary=fixture(25);
  equip(boundary,'laser');
  boundary.tanks[0].x=boundary.width-40;
  const end=step(boundary,{A:action(true)});
  const terminal=end.events.find(e=>e.type==='shell-expired');
  assert.equal(terminal.reason,'boundary');
  assert.equal(terminal.x,boundary.width);
  assert.equal(end.state.bullets.length,0);
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

test('mine arms for 0.8s, visibly triggers, and waits its separate 0.32s fuse',()=>{
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
  assert.equal(r.state.mines[0].detonateAt,29);
  r=doN(r.state,7);
  assert.equal(r.state.mines.length,1);
  r=step(r.state,{});
  assert.equal(r.events.filter(e=>e.type==='shot'&&e.sourceId==='m1').length,40);
  assert.equal(r.state.mines.length,0);
});

test('homing starts after 1.2 seconds and ignores the shooter; remote turns independently',()=>{
  const homing=fixture(25);
  equip(homing,'missile');
  let r=step(homing,{A:action(true)});
  r=doN(r.state,29);
  assert.equal(r.state.bullets[0].targetId,null);
  assert.equal(r.state.bullets[0].vy,0);
  r=step(r.state,{});
  assert.equal(r.state.bullets[0].targetId,'C');
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
