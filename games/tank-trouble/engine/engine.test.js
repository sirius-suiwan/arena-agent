import test from 'node:test';
import assert from 'node:assert/strict';
import { game } from '../adapter/index.js';

const initial = (seed=44,config) => game.init({seed,config,players:['a','b']});
const act = (throttle=0,turn=0,fire=false)=>({throttle,turn,fire});

test('seeded connected maze and deterministic immutable stepping', () => {
  let a=initial(), b=initial();
  assert.deepEqual(a,b);
  assert.notDeepEqual(a.walls, initial(45).walls);
  const {cols,rows}=a.config;
  const visited=new Set([0]), pending=[0], wall=(x1,y1,x2,y2)=>a.walls.some(w=>
    w.x1===x1&&w.y1===y1&&w.x2===x2&&w.y2===y2);
  while (pending.length) {
    const i=pending.pop(), x=i%cols,y=Math.floor(i/cols), X=x*64,Y=y*64;
    for (const [j,ok] of [[i-1,x>0&&!wall(X,Y,X,Y+64)],[i+1,x<cols-1&&!wall(X+64,Y,X+64,Y+64)],
       [i-cols,y>0&&!wall(X,Y,X+64,Y)],[i+cols,y<rows-1&&!wall(X,Y+64,X+64,Y+64)]]) {
      if(ok&&!visited.has(j)) {visited.add(j);pending.push(j);}
    }
  }
  assert.equal(visited.size,cols*rows);
  for (let i=0;i<200&&!a.result;i++) {
    const actions={a:act(1,i%2,!(i%4)),b:act(-1,-1,!(i%3))};
    const snapshot=JSON.stringify(a);
    const p=game.step(a,actions), q=game.step(b,actions);
    assert.equal(JSON.stringify(a),snapshot);
    assert.deepEqual(p,q);
    a=p.state;b=q.state;
  }
});

test('simultaneous hits draw, stable ID links and no further tick', () => {
  const s=initial();
  const [a,b]=s.tanks;
  Object.assign(a,{x:100,y:100,angle:0});
  Object.assign(b,{x:122,y:100,angle:Math.PI});
  s.walls=[];
  s.bullets=[
    {id:'b1',owner:'a',x:102,y:100,vx:6,vy:0,ttl:50,ownerArmed:false},
    {id:'b2',owner:'b',x:120,y:100,vx:-6,vy:0,ttl:50,ownerArmed:false}
  ];
  const r=game.step(s,{});
  assert.deepEqual(r.result,{winner:null,reason:'double-knockout'});
  assert.deepEqual(r.events.filter(e=>e.type==='hit').map(e=>[e.bulletId,e.tankId]),[['b1','b'],['b2','a']]);
  assert.equal(game.step(r.state,{}).state,r.state);
});

test('shells bounce with stable IDs and expire at TTL', () => {
  const s=initial();
  s.walls=[{x1:64,y1:0,x2:64,y2:128}];
  s.tanks[0].x=100;s.tanks[0].y=100;
  s.tanks[1].x=115;s.tanks[1].y=150;
  s.bullets=[{id:'probe',owner:'a',x:57,y:64,vx:6,vy:0,ttl:2,ownerArmed:true}];
  const {state,events}=game.step(s,{});
  assert.equal(events[0].type,'bounce');
  assert.equal(events[0].bulletId,'probe');
  assert.equal(state.bullets[0].vx,-6);
  assert.ok(state.bullets[0].x<61);
  const second=game.step(state,{});
  assert.equal(second.state.bullets.length,0);
  assert.deepEqual(second.events.map(e=>[e.type,e.reason]),[['shell-expired','ttl']]);
});

test('near wall self hits are allowed after a bounce', () => {
  const s=initial();
  s.walls=[{x1:70,y1:0,x2:70,y2:128}];
  Object.assign(s.tanks[0],{x:58,y:64,angle:0});
  Object.assign(s.tanks[1],{x:20,y:100,angle:0});
  const first=game.step(s,{a:act(0,0,true)});
  const second=game.step(first.state,{});
  assert.equal(second.result?.winner,'b');
  assert.deepEqual([...first.events,...second.events].map(e=>e.type),['shot','bounce','hit','destroyed','ended']);
});

test('config and action boundaries, pickup spawn, timeout, detached observation', () => {
  assert.throws(()=>initial(1,{cols:2}),/cols/);
  assert.throws(()=>initial(1,{notAKey:true}),/unknown/);
  assert.throws(()=>game.validateAction({throttle:1,turn:0,fire:1}),/action/);
  assert.throws(()=>game.validateAction({throttle:1,turn:0,fire:true,other:0}),/action/);
  const s=initial(1,{maxTicks:1,pickupInterval:1});
  const r=game.step(s,{});
  assert.ok(r.state.pickups.length===1);
  assert.equal(r.result.reason,'timeout');
  assert.equal(r.events[0].type,'pickup-spawn');
  const o=game.observe(s,'a');
  o.walls[0].x1=-99;
  o.tanks[0].x=-99;
  assert.notEqual(s.walls[0].x1,-99);
  assert.notEqual(s.tanks[0].x,-99);
});

test('pickup ties use only seed, not action insert order; shield absorbs one hit', () => {
  const s=initial();
  s.walls=[];
  Object.assign(s.tanks[0],{x:85,y:100,angle:0});
  Object.assign(s.tanks[1],{x:115,y:100,angle:Math.PI});
  s.pickups=[{id:'probe',x:100,y:100,type:'shield'}];
  const r=game.step(s,{a:act(),b:act()}), q=game.step(s,{b:act(),a:act()});
  assert.deepEqual(r,q);
  const t=r.state.tanks.find(t=>t.shield);
  assert.ok(t);
  assert.equal(r.state.pickups.length,0);
  r.state.bullets=[{id:'test',owner:t.id==='a'?'b':'a',x:t.x,y:t.y-17,vx:0,vy:6,ttl:50,ownerArmed:true}];
  const m=game.step(r.state,{});
  assert.equal(m.events.find(e=>e.type==='hit')?.absorbed,true);
  assert.equal(m.state.tanks.find(x=>x.id===t.id)?.shield,false);
  assert.equal(m.result,null);
});
