import test from 'node:test';
import assert from 'node:assert/strict';
import { classicRoundGame as game } from '../adapter/index.js';

const neutral={throttle:0,turn:0,fire:false};
const fire={...neutral,fire:true};
const move={...neutral,throttle:1};
const arena=(config={},players=['a','b'])=> {
  const s=game.init({seed:67,config:{pickups:false,...config},players});
  s.walls=[];
  return s;
};
const pose=(s,i,x,y,angle=0)=>Object.assign(s.tanks[i],{x,y,angle});
const stepN=(s,n,actions={})=> {
  let r={state:s};for(let i=0;i<n;i++)r=game.step(r.state,actions);return r;
};

test('v2 uses deterministic connected mazes and accepts two or three seats without v1 shield',()=>{
  const input={seed:'round-3',players:['a','b','c']};
  const a=game.init(input), b=game.init(input);
  assert.deepEqual(a,b);
  assert.notDeepEqual(a.walls,game.init({...input,seed:'round-4'}).walls);
  assert.equal(new Set(a.tanks.map(t=>[t.x,t.y].join(','))).size,3);
  assert.ok(a.tanks.every(t=>t.weapon===null&&!Object.hasOwn(t,'shield')));
  assert.throws(()=>game.init({...input,players:['a','b','c','d']}),/two or three/);
  const actions={b:fire,a:move,c:neutral};
  const s=JSON.stringify(a);
  assert.deepEqual(stepN(a,100,actions),stepN(b,100,actions));
  assert.equal(JSON.stringify(a),s);
});

test('five ordinary shell slots at 450 ticks; expiry releases a slot',()=>{
  const s=arena();
  pose(s,0,20,20);pose(s,1,450,340);
  const first=game.step(s,{a:fire});
  assert.equal(first.state.bullets[0].ttl,449);
  assert.equal(first.state.bullets[0].kind,'shell');
  const stalled=stepN(first.state,24*5,{a:fire});
  assert.equal(stalled.state.bullets.length,5);
  assert.ok(stalled.events.some(e=>e.reason==='shell-limit'));
  const expired=stepN(stalled.state,449-24*5);
  assert.ok(expired.events.some(e=>e.type==='shell-expired'&&e.bulletId==='b1'&&e.reason==='ttl'));
  assert.equal(game.step(expired.state,{a:fire}).state.bullets.length,5);
});

test('last tank must survive 180 ticks, late self hit changes round to draw',()=>{
  const s=arena();
  pose(s,0,60,80);pose(s,1,100,80);
  s.bullets=[{id:'starter',owner:'a',kind:'shell',x:83,y:80,vx:6,vy:0,ttl:60,ownerArmed:true}];
  const pending=game.step(s,{});
  assert.equal(pending.result,null);
  assert.equal(pending.state.settleUntil,181);
  assert.ok(pending.events.some(e=>e.type==='last-tank-pending'));
  assert.equal(stepN(pending.state,179).result,null);
  assert.deepEqual(stepN(pending.state,180).result,{winner:'a',reason:'last-tank'});
  const failing=structuredClone(pending.state);
  failing.bullets=[{id:'returned',owner:'a',kind:'shell',x:43,y:80,vx:6,vy:0,ttl:60,ownerArmed:true}];
  assert.deepEqual(game.step(failing,{}).result,{winner:null,reason:'double-knockout'});
});

test('classic regular shell ricochets and can destroy its owner with one hit',()=>{
  const s=arena();
  s.walls=[{x1:70,y1:0,x2:70,y2:128}];
  pose(s,0,58,64);pose(s,1,20,100);
  const first=game.step(s,{a:fire});
  const second=game.step(first.state,{});
  assert.equal(second.result,null);
  assert.equal(second.state.tanks[0].alive,false);
  assert.deepEqual([...first.events,...second.events].map(e=>e.type),
    ['shot','bounce','hit','destroyed','last-tank-pending']);
});

test('a seeded crate race is independent of action map order and does not overwrite an equipped weapon',()=>{
  const s=arena({pickups:true});
  pose(s,0,85,100);pose(s,1,115,100);
  s.pickups=[{id:'crate',x:100,y:100,type:'frag'}];
  const a=game.step(s,{a:neutral,b:neutral}), b=game.step(s,{b:neutral,a:neutral});
  assert.deepEqual(a,b);
  const equipped=a.state.tanks.find(t=>t.weapon==='frag');
  assert.equal(a.state.pickups.length,0);
  a.state.pickups=[{id:'new',x:equipped.x,y:equipped.y,type:'mine'}];
  const r=game.step(a.state,{});
  assert.equal(r.state.tanks.find(x=>x.id===equipped.id).weapon,'frag');
  assert.equal(r.state.pickups.length,1);
  assert.equal(game.observe(r.state,equipped.id).playerId,equipped.id);
});

test('Death Ray charge is cancellable; a completed beam penetrates walls and ends the held weapon',()=>{
  const s=arena();
  pose(s,0,60,90);pose(s,1,210,90);
  s.walls=[{x1:120,y1:0,x2:120,y2:150}];
  Object.assign(s.tanks[0],{weapon:'death-ray',weaponAmmo:1});
  const charging=stepN(s,89,{a:fire});
  assert.equal(charging.state.tanks[1].alive,true);
  const canceled=game.step(charging.state,{a:neutral});
  assert.equal(canceled.state.tanks[0].weaponCharge,0);
  const completed=stepN(canceled.state,90,{a:fire});
  assert.equal(completed.state.tanks[0].weapon,null);
  assert.equal(completed.state.tanks[1].alive,false);
  assert.ok(completed.events.some(e=>e.type==='weapon-fired'&&e.weapon==='death-ray'));
});

test('Gatling uses a finite magazine independent of regular shell slots',()=>{
  const s=arena();
  pose(s,0,60,90);pose(s,1,250,250);
  Object.assign(s.tanks[0],{weapon:'gatling',weaponAmmo:18});
  let r={state:s}, shots=[];
  for(let i=0;i<103;i++){
    r=game.step(r.state,{a:fire});
    shots.push(...r.events.filter(e=>e.type==='shot'));
  }
  assert.equal(shots.length,18);
  assert.ok(shots.every(e=>e.kind==='gatling'));
  assert.equal(r.state.tanks[0].weapon,null);
  assert.equal(game.step(r.state,{a:fire}).events.find(e=>e.type==='shot')?.kind,'shell');
});

test('Frag responds once per press and emits linked shrapnel on detonation',()=>{
  const s=arena();
  pose(s,0,60,90);pose(s,1,250,250);
  Object.assign(s.tanks[0],{weapon:'frag',weaponAmmo:1});
  const first=game.step(s,{a:fire}), held=game.step(first.state,{a:fire});
  assert.equal(held.state.bullets.length,1);
  const far=stepN(held.state,8);
  const blast=game.step(far.state,{a:fire});
  const burst=blast.events.find(e=>e.type==='frag-burst');
  assert.equal(burst.bulletId,'b1');
  assert.equal(blast.state.bullets.length,16);
  assert.ok(blast.state.bullets.every(b=>b.kind==='shrapnel'&&b.sourceId==='b1'));
  assert.equal(blast.state.tanks[0].weapon,null);
});

test('Mine placement requires a fresh press; armed mine blasts with durable source IDs',()=>{
  const s=arena();
  pose(s,0,60,90);pose(s,1,110,100);
  Object.assign(s.tanks[0],{weapon:'mine',weaponAmmo:3});
  const first=game.step(s,{a:fire}), held=game.step(first.state,{a:fire});
  assert.equal(held.state.mines.length,1);
  assert.equal(held.state.tanks[0].weaponAmmo,2);
  const {state}=stepN(held.state,27);
  state.tanks[1].x=45;state.tanks[1].y=90;
  assert.equal(game.step(state,{}).state.mines.length,1);
  const blast=stepN(state,2);
  assert.equal(blast.state.mines.length,0);
  assert.ok(blast.events.some(e=>e.type==='mine-burst'&&e.mineId==='m1'));
  assert.equal(blast.state.bullets.length,12);
  assert.ok(blast.state.bullets.every(b=>b.sourceId==='m1'));
});

test('classic Laser previews a short reflected path and consumes one press; the reflected beam can kill its owner',()=>{
  const s=arena({pickups:true});
  pose(s,0,60,90);pose(s,1,260,250);
  s.walls=[{x1:100,y1:0,x2:100,y2:380}];
  s.pickups=[{id:'laser-crate',x:60,y:90,type:'laser'}];
  const grab=game.step(s,{a:neutral});
  assert.equal(grab.state.tanks[0].weapon,'laser');
  const guide=game.observe(grab.state,'a').tanks[0].aimGuide;
  assert.deepEqual(guide.slice(0,2),[{x:60,y:90},{x:100,y:90}]);
  assert.ok(guide.at(-1).x<60);
  const shot=game.step(grab.state,{a:fire});
  assert.equal(shot.state.bullets.length,0);
  assert.equal(shot.state.tanks[0].alive,false);
  assert.equal(shot.state.tanks[0].weapon,null);
  assert.equal(shot.state.tanks[0].aimGuide,null);
  const beam=shot.events.find(e=>e.type==='weapon-fired'&&e.weapon==='laser');
  assert.deepEqual(beam.path.slice(0,2),guide.slice(0,2));
  assert.ok(Math.abs(beam.endX-72)<1e-6);
  assert.equal(shot.events.find(e=>e.type==='hit').ownerId,'a');
});

test('classic Laser stops at the first tank and does not pass through it',()=>{
  const s=arena({},['a','b','c']);
  pose(s,0,60,90);pose(s,1,100,90);pose(s,2,150,90);
  Object.assign(s.tanks[0],{weapon:'laser',weaponAmmo:1});
  const r=game.step(s,{a:fire});
  assert.equal(r.state.tanks[1].alive,false);
  assert.equal(r.state.tanks[2].alive,true);
  assert.equal(r.events.filter(e=>e.type==='hit').length,1);
});
