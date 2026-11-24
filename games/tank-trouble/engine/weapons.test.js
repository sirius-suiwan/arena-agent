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
    assert.equal(r.events.find(e=>e.type==='shot').x,s.tanks[0].x+18);
    assert.equal(r.state.bullets[0].ownerArmed,true);
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

test('a muzzle pressed against a wall cannot spawn a shell on the far side',()=>{
  const s=fixture(60);
  s.walls=[{x1:86,y1:64,x2:86,y2:160}];
  const r=step(s,{A:action(true)});
  const shell=r.events.find(e=>e.type==='shot');
  assert.ok(shell.x>70&&shell.x<=83);
  assert.ok(r.events.some(e=>e.type==='bounce'&&e.vx<0));
  assert.ok(r.events.some(e=>e.type==='hit'&&e.tankId==='A'&&e.ownerId==='A'));
});

test('Gatling requires a fresh press and fires one pellet at a time for exactly 20 rounds',()=>{
  for(const hz of [25,30,60]) {
    const start=fixture(hz);
    equip(start,'gatling',20);
    start.tanks[0].fireHeld=true;
    const holding=doN(start,8,{A:action(true)});
    assert.equal(holding.state.tanks[0].weaponCharge,0);
    assert.equal(holding.state.bullets.length,0);
    const ready=step(holding.state,{A:action(false)}).state;
    let r=step(ready,{A:action(true)}),shots=[];
    assert.equal(r.events[0].type,'weapon-charge');
    for(let i=1;i<Math.ceil(3.4*hz);i++){
      r=step(r.state,{A:action(true)});
      const fired=r.events.filter(e=>e.type==='shot');
      if(!fired.length) continue;
      assert.equal(fired.length,1);
      const [e]=fired;
      assert.equal(e.x,88);
      assert.ok(Math.abs(Math.hypot(e.vx,e.vy)-176/hz)<1e-12);
      assert.ok(Math.abs(Math.atan2(e.vy,e.vx))<=5.5*Math.PI/180);
      shots.push(r.state.tick-ready.tick);
    }
    assert.deepEqual(shots,Array.from({length:20},(_,i)=>Math.ceil((12+i*3)*hz/25)));
    assert.equal(r.state.tanks[0].weaponAmmo,0);
    assert.ok(r.state.bullets.every(b=>b.ttl<5*hz));
    assert.equal(r.state.tanks[0].weapon,'gatling');
    assert.equal(r.state.tanks[0].spinDownUntil,undefined);
    r=doN(r.state,Math.ceil(1.8*hz));
    assert.equal(r.state.tanks[0].weapon,null);
  }
});

test('Gatling pellets may hit any valid tank only after the original two safe frames',()=>{
  for(const hz of [25,30,60]) {
    const start=fixture(hz);
    start.tanks[1].x=155;start.tanks[1].y=100;
    start.bullets.push({id:'safe',owner:'A',kind:'gatling',x:155,y:100,vx:0,vy:0,
      ttl:start.profile.gatlingTtl,safeTicks:start.profile.gatlingSafeTicks,ownerArmed:true});
    const timer=doN(start,Math.ceil(hz*2/25));
    assert.equal(timer.state.tanks[1].alive,true);
    const ready=step(timer.state,{});
    assert.equal(ready.events.find(e=>e.type==='hit')?.tankId,'B');
  }
});

test('Gatling pellets and fragments use their own narrower hit radii',()=>{
  const s=fixture();
  Object.assign(s.tanks[1],{x:100,y:114});
  const shell=kind=>({id:'b1',owner:'A',x:80,y:100,vx:25,vy:0,ttl:5,kind,ownerArmed:false});
  assert.equal(s.profile.gatlingRadius,1.35);
  assert.equal(s.profile.fragmentRadius,0);
  assert.equal(step({...s,bullets:[shell('gatling')]},{}).state.tanks[1].alive,true);
  assert.equal(step({...s,bullets:[shell('shell')]},{}).state.tanks[1].alive,false);
  Object.assign(s.tanks[1],{y:114.5});
  assert.equal(step({...s,bullets:[shell('shrapnel')]},{}).state.tanks[1].alive,true);
});

test('releasing gatling cancels an incomplete burst and requires spin-down before normal fire',()=>{
  const s=fixture(25);
  equip(s,'gatling',20);
  let r=doN(s,12,{A:action(true)});
  assert.equal(r.state.bullets.length,1);
  r=step(r.state,{A:action(false)});
  assert.equal(r.state.tanks[0].weaponAmmo,0);
  assert.equal(r.state.tanks[0].spinDownUntil,57);
  r=doN(r.state,43,{A:action(true)});
  assert.equal(r.state.tanks[0].weapon,'gatling');
  assert.equal(r.state.bullets.length,1);
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

test('frag detonates on a fresh press into 40 independent, deterministic fragments',()=>{
  const run=()=>{
    const s=fixture(25);
    s.walls=[{x1:117,y1:64,x2:117,y2:160}];
    equip(s,'frag');
    let r=step(s,{A:action(true)});
    assert.equal(r.events.find(e=>e.type==='shot').x,88);
    r=step(r.state,{A:action(true)});
    assert.equal(r.state.bullets[0].kind,'frag');
    r=step(step(r.state,{}).state,{A:action(true)});
    return r;
  };
  let r=run();
  assert.deepEqual(r,run());
  const debris=r.events.filter(e=>e.type==='shot'&&e.kind==='shrapnel');
  assert.equal(debris.length,40);
  assert.ok(new Set(debris.map(e=>Math.round(Math.hypot(e.vx,e.vy)*1000))).size>25);
  assert.ok(r.state.bullets.every(b=>b.kind==='shrapnel'&&b.sourceId==='b1'&&b.ttl===null));
  r=doN(r.state,2);
  assert.equal(r.events.some(e=>e.type==='bounce'),false);
});

test('mother shell cannot detonate twice when its shot and its owner are killed on the same tick',()=>{
  for(const impact of [false,true]) {
    const s=fixture(60);
    Object.assign(s.tanks[0],{weapon:'frag',fragId:'mother'});
    Object.assign(s.tanks[1],{x:160,y:100});
    s.bullets=[
      {id:'mother',owner:'A',kind:'frag',x:impact?143:115,y:100,vx:3,vy:0,ttl:100,ownerArmed:true},
      {id:'killer',owner:'B',kind:'shell',x:86,y:100,vx:-6,vy:0,ttl:100,ownerArmed:true},
    ];
    const r=step(s,{});
    assert.equal(r.state.tanks[0].alive,false);
    assert.equal(r.state.tanks[1].alive,!impact);
    assert.equal(r.events.filter(e=>e.type==='frag-burst').length,1);
    assert.equal(r.events.filter(e=>e.type==='shot'&&e.sourceId==='mother').length,40);
    assert.equal(r.state.rng,s.rng,'fragment RNG must not change pickup stream');
    assert.ok(!r.state.bullets.some(b=>b.id==='mother'));
  }
});

test('shrapnel may outlast one second and stops at a wall without bouncing',()=>{
  const s=fixture(25);
  s.walls=[{x1:320,y1:32,x2:320,y2:128}];
  s.bullets=[{id:'b',kind:'shrapnel',owner:'B',ownerArmed:true,x:150,y:60,vx:6,vy:0,ttl:null}];
  let r=doN(s,26);
  assert.equal(r.state.bullets[0].id,'b');
  r=doN(r.state,3);
  assert.equal(r.state.bullets.length,0);
  assert(r.events.some(e=>e.type==='shell-expired'&&e.kind==='shrapnel'&&e.reason==='wall'));
  assert(!r.events.some(e=>e.type==='bounce'));
});

test('a mine is thrown backwards, bounces, lands, and the third throw releases the slot',()=>{
  const s=fixture(25);
  s.walls=[{x1:65,y1:64,x2:65,y2:128}];
  equip(s,'mine',3);
  let r=step(s,{A:action(true)});
  assert.equal(r.events.find(e=>e.type==='mine-placed').x,70);
  assert.ok(r.state.mines[0].vx>0&&r.state.mines[0].x>65);
  for(let n=0;n<2;n++) r=step(step(r.state,{}).state,{A:action(true)});
  assert.equal(r.state.tanks[0].weapon,null);
  assert.equal(r.state.mines.length,3);
  r=doN(r.state,10);
  assert.ok(r.state.mines.every(m=>m.vx===0&&m.vy===0));
});

test('hidden mine activates on contact (including owner), waits for everyone to leave, then cannot reset',()=>{
  for(const hz of [25,30,60]) {
    const s=fixture(hz);
    const observer=gameForRate(hz);
    equip(s,'mine',3);
    let r=step(s,{A:action(true)});
    const ready=r.state.mines[0].armedAt;
    assert.equal(ready,1+hz*0.8);
    r=doN(r.state,Math.ceil(hz*1.22));
    const [mine]=r.state.mines;
    assert.equal(mine.visibility,0);
    assert.equal(observer.observe(r.state,'A').mines.length,0);
    Object.assign(r.state.tanks[0],{x:mine.x-13,y:mine.y});
    Object.assign(r.state.tanks[1],{x:mine.x+13,y:mine.y});
    r=step(r.state,{});
    assert.equal(r.events.find(e=>e.type==='mine-activated').tankId,'A');
    assert.equal(r.state.mines[0].detonateAt,null);
    Object.assign(r.state.tanks[0],{x:mine.x-45,y:mine.y});
    r=doN(r.state,Math.ceil(hz*0.3));
    assert.equal(r.state.mines[0].detonateAt,null);
    Object.assign(r.state.tanks[1],{x:mine.x+45,y:mine.y});
    r=step(r.state,{});
    const fuse=r.events.find(e=>e.type==='mine-trigger').detonateAt;
    assert.ok(Math.abs(fuse-r.state.tick-hz*0.2)<1e-9);
    Object.assign(r.state.tanks[1],{x:mine.x+13,y:mine.y});
    while(r.state.tick+1<Math.ceil(fuse-1e-7)) {
      r=step(r.state,{});
      assert.equal(r.state.mines[0].detonateAt,fuse);
    }
    r=step(r.state,{});
    assert.equal(r.events.filter(e=>e.type==='shot'&&e.sourceId==='m1').length,40);
    assert.equal(r.state.mines.length,0);
  }
});

test('homing reserves its slot but not its hull; navigation starts after two seconds at all rates',()=>{
  for(const rate of [25,30,60]) {
    const s=fixture(rate);
    Object.assign(s.tanks[1],{x:369,y:190});
    equip(s,'missile');
    let r=step(s,{A:action(true)});
    const shot=r.events.find(e=>e.kind==='missile');
    assert.equal(shot.x,88);
    assert.equal(r.state.tanks[0].weapon,'missile');
    assert.equal(r.state.tanks[0].fragId,shot.bulletId);
    assert.equal(r.state.bullets[0].ownerArmed,true);
    r=step(r.state,{A:action(false,0,-1)});
    assert.ok(r.state.tanks[0].x<70);
    r=doN(r.state,2*rate-2);
    assert.equal(r.state.bullets[0].targetId,null);
    assert.equal(r.state.bullets[0].vy,0);
    r=step(r.state,{});
    assert.equal(r.state.bullets[0].targetId,'B');
    assert.ok(r.state.bullets[0].vy>0);
    assert.ok(Math.hypot(r.state.bullets[0].vx,r.state.bullets[0].vy)<=144/rate+1e-12);
  }
});

test('homing chooses maze distance, uses the next cell, and prefers a non-owner only on a tie',()=>{
  const s=fixture(25);
  s.walls=[{x1:128,y1:0,x2:128,y2:192}];
  Object.assign(s.tanks[0],{x:600,y:630,weapon:'missile',fragId:'homing'});
  Object.assign(s.tanks[1],{x:162,y:95});
  Object.assign(s.tanks[2],{x:97,y:225});
  s.bullets=[{id:'homing',owner:'A',kind:'missile',x:115,y:95,vx:0,vy:0,ttl:20,age:50,ownerArmed:true}];
  const tracked=step(s,{}).state.bullets[0];
  assert.equal(tracked.targetId,'C'); // B is closer on screen, behind the long wall.
  assert.ok(tracked.vx<0&&tracked.vy>0); // Aim at the next cell centre, behind its x.
  const ties={...s,walls:[],tanks:[
    {...s.tanks[0],x:86,y:85},{...s.tanks[1],x:86,y:110},{...s.tanks[2]}
  ]};
  assert.equal(step(ties,{}).state.bullets[0].targetId,'B');
  const team={...ties,teams:{A:'1',B:'1',C:'2'},friendlyFire:false};
  assert.equal(step(team,{}).state.bullets[0].targetId,'A');
  const farther={...ties,tanks:[ties.tanks[0],{...ties.tanks[1],x:40},ties.tanks[2]]};
  assert.equal(step(farther,{}).state.bullets[0].targetId,'A');
});

test('remote hull stays locked, steering changes heading before velocity, and walls reflect both',()=>{
  const remote=fixture(25);
  equip(remote,'remote');
  let r=step(remote,{A:action(true)});
  assert.equal(r.events.find(e=>e.kind==='remote').x,88);
  r=step(r.state,{A:action(false,1,1)});
  assert.equal(r.state.tanks[0].x,70);
  assert.equal(r.state.tanks[0].angle,0);
  const b=r.state.bullets[0];
  const travel=Math.atan2(b.vy,b.vx);
  assert.ok(Math.abs(b.heading-375*Math.PI/180/25)<1e-12);
  assert.ok(travel>0&&travel<b.heading);
  assert.ok(Math.hypot(b.vx,b.vy)<=5.76+1e-12);

  const wall={...r.state,walls:[{x1:140,y1:64,x2:140,y2:160}],
    bullets:[{...b,x:135,y:100,vx:5,vy:0,heading:0.4}]};
  const reflected=step(wall,{});
  assert.ok(reflected.events.some(e=>e.type==='bounce'&&e.bulletId===b.id));
  const after=reflected.state.bullets[0];
  assert.ok(after.vx<0&&Math.abs(after.heading-(Math.PI-0.4))<1e-12);
  const dead={...reflected.state,tanks:[{...reflected.state.tanks[0],alive:false},...reflected.state.tanks.slice(1)]};
  assert.equal(step(dead,{A:action(false,1)}).state.bullets[0].heading,after.heading);
});

test('a guided missile returns the slot on either impact or expiry, without a duplicate shot',()=>{
  for(const weapon of ['missile','remote']){
    const s=fixture(25);
    equip(s,weapon);
    let r=step(s,{A:action(true)});
    r=step(r.state,{A:action(false)});
    r=step(r.state,{A:action(true)});
    assert.equal(r.events.some(e=>e.type==='shot'),false);
    const waits=r.state;
    r=step({...waits,bullets:[{...waits.bullets[0],ttl:1}]},{});
    assert.equal(r.state.tanks[0].weapon,null);
    assert.equal(r.events.find(e=>e.type==='shell-expired').reason,'ttl');
    const hit=step({...waits,tanks:[waits.tanks[0],{...waits.tanks[1],x:waits.bullets[0].x+17,
      y:waits.bullets[0].y},waits.tanks[2]]},{});
    assert.equal(hit.state.tanks[0].weapon,null);
    assert.equal(hit.state.tanks[1].alive,false);
    assert.equal(hit.events.find(e=>e.type==='shell-expired').reason,'impact');
  }
});
