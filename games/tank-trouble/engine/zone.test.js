import assert from 'node:assert/strict';
import {test} from 'node:test';
import {init,step} from './classic.js';
import {gameForRate} from '../adapter/index.js';

const players=['A','B'];
const game=gameForRate(60);
const make=(config={})=>init({seed:37,config:{pickups:false,...config},players},60);
const put=(state,id,point)=>({...state,tanks:state.tanks.map(t=>t.id===id?{...t,...point}:t)});
const fire={throttle:0,turn:0,fire:true};
const shell=(id,owner,x,y,vx)=>({id,owner,kind:'shell',x,y,vx,vy:0,ttl:60,ownerArmed:true});
const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} ≈ ${b}`);

test('safe rectangle covers the map at start and preserves its aspect ratio while shrinking linearly',()=>{
  const state=make(),{zone}=state;
  assert.equal(zone.startTick,2400);
  assert.equal(zone.endTick,3300);
  assert.equal(zone.graceTicks,120);
  near(zone.finalHalfWidth,32);
  near(zone.finalHalfHeight,24);
  assert.deepEqual([zone.x,zone.y],[352,288]);
  for(const x of [0,state.width]) for(const y of [0,state.height]) {
    assert(Math.abs(x-zone.x)<=zone.halfWidth+1e-9);
    assert(Math.abs(y-zone.y)<=zone.halfHeight+1e-9);
  }
  const before=step({...state,tick:2398},{}).state;
  const start=step(before,{}).state;
  assert.deepEqual(before.zone,start.zone);
  const halfway=step({...start,tick:2849},{}).state;
  near(halfway.zone.halfWidth,(zone.initialHalfWidth+zone.finalHalfWidth)/2);
  near(halfway.zone.halfHeight,(zone.initialHalfHeight+zone.finalHalfHeight)/2);
  near(halfway.zone.halfWidth/halfway.zone.halfHeight,state.width/state.height);
  assert.equal(step({...start,tick:3299},{}).state.zone.halfHeight,zone.finalHalfHeight);
});

test('timing controls are independent and round timeout extends unless explicitly set',()=>{
  const custom=make({shrinkAfterSeconds:120,shrinkDurationSeconds:120});
  assert.equal(custom.zone.startTick,7200);
  assert.equal(custom.zone.endTick,14400);
  assert.equal(custom.config.maxTicks,14700);
  assert.equal(make({shrinkAfterSeconds:120,maxTicks:200}).config.maxTicks,200);
  const fast=make({shrinkAfterSeconds:0,shrinkDurationSeconds:1});
  assert.deepEqual([fast.zone.startTick,fast.zone.endTick,fast.config.maxTicks],[0,60,3600]);
  assert.equal(game.matchTickLimit({scoreToWin:3,shrinkAfterSeconds:120,shrinkDurationSeconds:120}),44280);
  assert.equal(game.matchTickLimit({maxTicks:36000}),100_000);
  for(const value of [-1,121,0.5,'40',null]) assert.throws(()=>make({shrinkAfterSeconds:value}),/shrinkAfterSeconds/);
  for(const value of [0,121,0.5,'15',null]) assert.throws(()=>make({shrinkDurationSeconds:value}),/shrinkDurationSeconds/);
});

test('outside exposure is consecutive, with exact edge re-entry safe',()=>{
  let state=make({shrinkAfterSeconds:0});
  const {x,y,endTick,finalHalfWidth}=state.zone;
  state=put(state,'A',{x:x+finalHalfWidth+2,y});
  state=put(state,'B',{x,y});
  state={...state,walls:[],tick:endTick,zone:{...state.zone,outsideTicks:{A:118,B:0}}};
  const outside=step(state,{}).state;
  assert.equal(outside.zone.outsideTicks.A,119);
  assert.equal(outside.tanks[0].alive,true);
  assert.equal(state.zone.outsideTicks.A,118);
  const reentered=step(put(outside,'A',{x:x+finalHalfWidth,y}),{}).state;
  assert.equal(reentered.zone.outsideTicks.A,0);
  const loss=step(outside,{});
  assert.deepEqual(loss.events.map(e=>e.type),['zone-eliminated','last-tank-pending']);
  assert.equal(loss.events[0].tankId,'A');
  assert.equal(loss.events[0].ownerId,undefined);
  assert.equal(loss.state.settleUntil,loss.state.tick+180);
  assert.equal(loss.state.tanks[1].invulnerable,true);
});

test('two simultaneous environmental deaths still award nobody',()=>{
  const state=make({shrinkAfterSeconds:0});
  const loss=step({...state,tick:state.zone.endTick,zone:{...state.zone,outsideTicks:{A:119,B:119}}},{});
  assert.deepEqual(loss.result,{winner:null,reason:'double-knockout'});
  assert.deepEqual(loss.events.filter(e=>e.type==='zone-eliminated').map(e=>e.tankId),players);
  assert(!loss.events.some(e=>e.type==='destroyed'));
});

test('survivor is protected from stray shots, reflected laser, mine triggers and zone until scoring',()=>{
  let state=make({shrinkAfterSeconds:0,shrinkDurationSeconds:1});
  state=put(put(state,'A',{x:60,y:80,angle:0}),'B',{x:100,y:80});
  const pending=step({...state,walls:[],bullets:[shell('first','A',83,80,6)]},{});
  assert.equal(pending.state.tanks[0].invulnerable,true);
  assert.equal(pending.state.tanks[1].invulnerable,false);
  assert.equal(pending.state.tanks[1].alive,false);
  const locked=put(pending.state,'A',{weapon:'laser',weaponAmmo:1});
  const later=step({...locked,tick:100,
    walls:[{x1:90,y1:40,x2:90,y2:125}],
    bullets:[shell('later','B',43,80,6)],
    mines:[{id:'m1',owner:'B',x:62,y:80,armedAt:1,ownerCleared:true,detonateAt:null,triggeredAt:null}],
    zone:{...locked.zone,outsideTicks:{A:119,B:0}}},{A:fire});
  assert.equal(later.state.tanks[0].alive,true);
  assert.equal(later.state.zone.outsideTicks.A,0);
  assert.equal(later.state.mines.length,1);
  assert(later.events.some(e=>e.type==='weapon-fired'&&e.weapon==='laser'));
  assert(!later.events.some(e=>['hit','destroyed','mine-burst','zone-eliminated'].includes(e.type)));
  let finished=later;
  while(!finished.result) finished=step(finished.state,{});
  assert.deepEqual(finished.result,{winner:'A',reason:'last-tank'});
});

test('simultaneous projectile and zone deaths are resolved before granting immunity',()=>{
  let state=make({shrinkAfterSeconds:0,shrinkDurationSeconds:1});
  state=put(put(state,'A',{x:60,y:80}),'B',{x:100,y:80});
  const draw=step({...state,walls:[],tick:60,bullets:[shell('impact','A',83,80,6)],
    zone:{...state.zone,outsideTicks:{A:119,B:0}}},{});
  assert.deepEqual(draw.result,{winner:null,reason:'double-knockout'});
  assert(draw.events.some(e=>e.type==='destroyed'&&e.tankId==='B'));
  assert(draw.events.some(e=>e.type==='zone-eliminated'&&e.tankId==='A'));
});

test('series resets the zone for a fresh round and keeps observations detached',()=>{
  const initial=game.init({seed:37,config:{pickups:false,shrinkAfterSeconds:0},players});
  const obs=game.observe(initial,'A');
  obs.zone.halfWidth=0;
  obs.zone.outsideTicks.A=99;
  assert.equal(initial.zone.halfWidth,initial.zone.initialHalfWidth);
  assert.equal(initial.zone.outsideTicks.A,0);
  let state=initial, result=null;
  for(let i=0;i<1200;i++){
    result=game.step(state,{});
    state=result.state;
    if(result.events.some(e=>e.type==='round-start')) break;
  }
  assert.equal(state.round,2);
  assert.equal(state.roundTick,0);
  assert.equal(state.zone.startTick,0);
  assert.equal(state.zone.halfWidth,state.zone.initialHalfWidth);
  assert.deepEqual(state.zone.outsideTicks,{A:0,B:0});
  assert(state.tanks.every(t=>!t.invulnerable));
});
