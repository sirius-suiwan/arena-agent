import test from 'node:test';
import assert from 'node:assert/strict';
import { game,gameV3,classicRoundGameV4 as v4,classicRoundGameV3 as v3 } from '../adapter/index.js';

const input={seed:'shell-tuning',players:['amber','blue']};
const fire={throttle:0,turn:0,fire:true};
const speed=({vx,vy})=>Math.hypot(vx,vy);
function fixture(g,config={}) {
  const s=g.init({...input,config:{pickups:false,...config}});
  s.walls=[];
  Object.assign(s.tanks[0],{x:50,y:50,angle:0});
  Object.assign(s.tanks[1],{x:300,y:200,angle:0});
  return s;
}
function stepN(g,state,n,actions={}) {
  for(let i=0;i<n-1;i++) state=g.step(state,actions).state;
  return g.step(state,actions);
}

test('v4 ordinary shell default and override affect launch and displacement only',()=>{
  assert.equal(game.version,'4');
  assert.equal(gameV3.version,'3');
  for (const [g,config,expected] of [[v4,{},5.2],[v4,{shellSpeed:7.125},7.125],[v3,{},6]]) {
    const r=g.step(fixture(g,config),{amber:fire});
    const shell=r.state.bullets[0];
    assert.ok(Math.abs(speed(shell)-expected)<1e-9);
    assert.ok(Math.abs(shell.x-(50+expected))<1e-9);
    assert.equal(shell.ttl,449);
    assert.equal(r.state.tanks[0].cooldown,24);
  }
  assert.equal(game.observe(game.init(input),'amber').shellSpeed,5.2);
  assert.equal(game.observe(game.init(input),'amber').shellLimit,10);
  assert.equal(Object.hasOwn(gameV3.observe(gameV3.init(input),'amber'),'shellSpeed'),false);
  for (const val of [2.999,9.001,'5.2',NaN,Infinity,null]) {
    assert.throws(()=>v4.init({...input,config:{shellSpeed:val}}),/shellSpeed/);
  }
  assert.throws(()=>v3.init({...input,config:{shellSpeed:5.2}}),/unknown/);
});

test('special projectile speeds and slot independence remain unchanged in v4',()=>{
  const s=fixture(v4,{shellSpeed:8});
  Object.assign(s.tanks[0],{weapon:'frag',weaponAmmo:1});
  const frag=v4.step(s,{amber:fire}).state.bullets[0];
  assert.equal(frag.kind,'frag');
  assert.equal(speed(frag),4.5);
  Object.assign(s.tanks[0],{weapon:'gatling',weaponAmmo:18,weaponCharge:17});
  const gat=v4.step(s,{amber:fire}).state.bullets[0];
  assert.equal(gat.kind,'gatling');
  assert.ok(Math.abs(speed(gat)-7.5)<1e-9);
});

test('v4 holds ten live regular shells, reopens a slot on expiry, then fills it',()=>{
  const s=fixture(v4);
  // Nine distant special projectiles do not limit ordinary ammo.
  s.bullets=Array.from({length:9},(_,i)=>({id:'special'+i,owner:'amber',x:250+i,y:350,vx:1,vy:0,
    ttl:800,kind:'gatling',ownerArmed:true}));
  const cap=stepN(v4,s,241,{amber:fire});
  assert.equal(cap.state.shellLimit,10);
  assert.equal(cap.state.bullets.filter(b=>b.kind==='shell').length,10);
  assert.ok(cap.events.some(e=>e.type==='shot-blocked'&&e.reason==='shell-limit'));
  const expiry=stepN(v4,cap.state,209);
  assert.equal(expiry.state.bullets.filter(b=>b.kind==='shell').length,9);
  assert.ok(expiry.events.some(e=>e.type==='shell-expired'&&e.bulletId==='b1'));
  assert.equal(v4.step(expiry.state,{amber:fire}).state.bullets.filter(b=>b.kind==='shell').length,10);
  assert.equal(stepN(v3,fixture(v3),241,{amber:fire}).state.bullets.length,5);
});
