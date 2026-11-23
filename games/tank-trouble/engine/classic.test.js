import test from 'node:test';
import assert from 'node:assert/strict';
import {init,step} from './classic.js';
import {game,gameForRate} from '../adapter/index.js';

const neutral={throttle:0,turn:0,fire:false};
const fire={...neutral,fire:true};
const nudge={throttle:1,turn:1,fire:false};
const input={seed:'deterministic-combat',players:['A','B']};
const open=(rate=25,options={})=>{
  const s=init({...input,config:{pickups:false,...options}},rate);
  s.walls=[];
  Object.assign(s.tanks[0],{x:50,y:64,angle:0});
  Object.assign(s.tanks[1],{x:350,y:264,angle:0});
  return s;
};
const bullet=(id,owner,x,y,vx,ttl=30,kind='shell')=>({id,owner,x,y,vx,vy:0,ttl,kind,ownerArmed:true});
const distance=e=>Math.hypot(e.vx,e.vy);
const nearly=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≠ ${b}`);

test('same seed and ordered actions produce exact combat states without mutating the input',()=>{
  for(const rate of [25,30,60]) {
    let a=init(input,rate),b=init(input,rate);
    assert.deepEqual(a,b);
    assert.notDeepEqual(a.walls,init({...input,seed:'different'},rate).walls);
    for(let i=0;i<90;i++) {
      const snapshot=structuredClone(a);
      const actions={A:i%4===0?fire:nudge,B:i%6===0?fire:neutral};
      const left=step(a,actions),right=step(b,actions);
      assert.deepEqual(a,snapshot);
      assert.deepEqual(left,right);
      a=left.state;b=right.state;
      if(left.result) break;
    }
  }
});

test('simultaneous projectile eliminations draw with stable credit and terminal state',()=>{
  const s=open();
  Object.assign(s.tanks[1],{x:110,y:64});
  s.bullets=[bullet('left','A',94,64,6),bullet('right','B',66,64,-6)];
  const r=step(s,{});
  assert.deepEqual(r.result,{winner:null,reason:'double-knockout'});
  assert.deepEqual(r.events.filter(e=>e.type==='destroyed').map(e=>[e.bulletId,e.ownerId,e.tankId]),
    [['left','A','B'],['right','B','A']]);
  assert.equal(step(r.state,{}).state,r.state);
});

test('a projectile keeps its ID through a wall bounce, expiry, and a self-hit',()=>{
  const s=open();
  s.walls=[{x1:85,y1:0,x2:85,y2:130}];
  s.bullets=[bullet('next','A',79,50,6,2)];
  let r=step(s,{});
  assert.equal(r.events.find(e=>e.type==='bounce')?.bulletId,'next');
  assert.ok(r.state.bullets[0].vx<0);
  r=step(r.state,{});
  assert.equal(r.events.find(e=>e.type==='shell-expired')?.bulletId,'next');
  assert.equal(r.state.bullets.length,0);
  s.bullets=[bullet('returns','A',79,64,6,10)];
  r=step(s,{});
  for(let i=0;i<6&&r.state.tanks[0].alive;i++) r=step(r.state,{});
  assert.equal(r.state.tanks[0].alive,false);
  assert.ok(r.events.some(e=>e.type==='destroyed'&&e.bulletId==='returns'&&e.ownerId==='A'));
});

test('crate ties follow seed, not accepted-action property order',()=>{
  const s=open(25,{pickups:true});
  Object.assign(s.tanks[0],{x:100,y:110});
  Object.assign(s.tanks[1],{x:130,y:110});
  s.pickups=[{id:'crate',x:115,y:110,type:'laser'}];
  const a=step(s,{A:neutral,B:neutral}),b=step(s,{B:neutral,A:neutral});
  assert.deepEqual(a,b);
  assert.equal(a.state.tanks.filter(t=>t.weapon==='laser').length,1);
  assert.equal(a.state.pickups.length,0);
  const laser=a.state.tanks.find(t=>t.weapon==='laser');
  assert.ok(laser.aimGuide.length>=2);
});

test('shell speed override leaves special speed and ordinary lifetime unchanged',()=>{
  for(const rate of [25,30,60]) {
    const s=open(rate,{shellSpeed:4.2});
    const r=step(s,{A:fire});
    nearly(distance(r.state.bullets[0]),4.2);
    assert.equal(r.state.bullets[0].ttl,rate*10-1);
    Object.assign(s.tanks[0],{weapon:'frag',weaponAmmo:1});
    const f=step(s,{A:fire});
    nearly(distance(f.state.bullets[0]),144/rate);
    const current=gameForRate(rate);
    assert.equal(current.observe(current.init({...input,config:{shellSpeed:4.2}}),'A').shellSpeed,4.2);
  }
  for (const val of [0,100,'5.2',NaN,Infinity,null]) {
    assert.throws(()=>game.init({...input,config:{shellSpeed:val}}),/shellSpeed/);
  }
});

test('ordinary ammo cap counts only ordinary owned shells and opens when one expires',()=>{
  const s=open();
  const limit=s.shellLimit;
  const standard=Array.from({length:limit},(_,i)=>bullet('old'+i,'A',120+i,34,1,i===0?1:30));
  const extras=[bullet('enemy','B',200,120,1),bullet('special','A',200,140,1,30,'gatling')];
  s.bullets=[...standard,...extras];
  let r=step(s,{A:fire});
  assert.ok(r.events.some(e=>e.type==='shot-blocked'&&e.reason==='shell-limit'));
  assert.equal(r.events.find(e=>e.type==='shell-expired')?.bulletId,'old0');
  r=step(step(r.state,{}).state,{A:fire});
  assert.equal(r.state.bullets.filter(b=>b.owner==='A'&&b.kind==='shell').length,limit);
  assert.ok(r.state.bullets.some(b=>b.kind==='gatling'));
});
