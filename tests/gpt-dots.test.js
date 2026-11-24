import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {makePolicy} from '../bots/gpt-dots/policy.js';
import {game,gameForRate} from '../games/tank-trouble/adapter/index.js';
import {classicProfile} from '../games/tank-trouble/engine/profile.js';

const A={id:'A',x:60,y:60,angle:0,alive:true,weapon:null};
const B={id:'B',x:165,y:60,angle:Math.PI,alive:true,weapon:null};
const observation=(overrides={})=>({tick:42,round:1,roundTick:42,phase:'playing',
  width:256,height:256,playerId:'A',walls:[],tanks:[A,B],bullets:[],pickups:[],mines:[],shellLimit:10,
  profile:classicProfile(25),shellSpeed:144/25,...overrides});

test('GPT-dots takes an unobstructed shot and obeys laser press semantics',()=>{
  assert.deepEqual(makePolicy()(observation()),{throttle:0,turn:0,fire:true});
  assert.equal(makePolicy()(observation({tanks:[{...A,weapon:'laser',fireHeld:true},B]})).fire,false);
  assert.equal(makePolicy()(observation({tanks:[{...A,weapon:'laser',fireHeld:false},B]})).fire,true);
});

test('GPT-dots suppresses a shot as an incoming bullet threatens the firing position',()=>{
  const bullet={id:'b',x:108,y:60,vx:-5.2,vy:0,owner:'B',ttl:120};
  const action=makePolicy()(observation({bullets:[bullet]}));
  assert.equal(action.fire,false);
  assert.ok(action.throttle!==0||action.turn!==0);
});

test('GPT-dots picks a route through the maze rather than advancing through a wall',()=>{
  const state=observation({
    tanks:[{...A,x:32,y:32},{...B,x:96,y:32}],
    walls:[{x1:64,y1:0,x2:64,y2:64}]
  });
  const action=makePolicy()(state);
  assert.equal(action.throttle,0);
  assert.equal(action.turn,1);
  assert.equal(action.fire,false);
});

test('GPT-dots engine observation stream stays deterministic and legal with eight seats',()=>{
  const players=[...'ABCDEFGH'];
  let s=game.init({seed:'eight-dots',players,config:{cols:4,rows:4}});
  const left=makePolicy(),right=makePolicy();
  for(let i=0;i<60;i++){
    const obs=game.observe(s,'A'),a=left(obs),b=right(obs);
    assert.deepEqual(a,b);
    assert.deepEqual(game.validateAction(a),a);
    const actions=Object.fromEntries(players.map(id=>[id,id==='A'?a:{throttle:1,turn:1,fire:true}]));
    s=game.step(s,actions).state;
  }
  assert.equal(s.tick,60);
});

test('GPT-dots process speaks JSONL, answers the exact host tick and announces its registry name',()=>{
  const m=[{type:'start',protocol:1,game:'tank-trouble',playerId:'A',rulesVersion:game.version},
    {type:'observe',tick:123,observation:observation()}];
  const p=spawnSync(process.execPath,['bots/gpt-dots/bot.js'],{
    input:m.map(JSON.stringify).join('\n')+'\n',encoding:'utf8',timeout:2000});
  assert.equal(p.status,0,p.stderr);
  assert.equal(p.stderr,'');
  const [ready,reply]=p.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(ready,{type:'ready',protocol:1,name:'GPT-dots'});
  assert.equal(reply.tick,123);
  assert.deepEqual(game.validateAction(reply.action),reply.action);
});

test('GPT-dots rounds a wall tip and collects the crate that previously kept it stationary',()=>{
  let s=game.init({seed:1,players:['A','B']});
  s.walls=[{x1:64,y1:0,x2:64,y2:64}];
  Object.assign(s.tanks[0],{x:50,y:64.1,angle:Math.atan2(31.9,46)});
  Object.assign(s.tanks[1],{x:700,y:520});
  s.pickups=[{id:'corner',x:96,y:96,type:'laser'}];
  const bot=makePolicy();
  for(let i=0;i<78&&!s.tanks[0].weapon;i++) {
    s=game.step(s,{A:bot(game.observe(s,'A'))}).state;
  }
  assert.equal(s.tanks[0].weapon,'laser');
  assert.equal(s.pickups.some(p=>p.id==='corner'),false);
});

test('GPT-dots advances for a reachable crate at its ordinary shell cap',()=>{
  const state=observation({
    tanks:[{...A,x:32,y:32},{...B,x:165,y:32}],
    bullets:Array.from({length:10},(_,i)=>({id:'live'+i,owner:'A',kind:'shell',x:230,y:230,vx:0,vy:1,ttl:60})),
    pickups:[{id:'crate',x:96,y:32,type:'mine'}]
  });
  assert.deepEqual(makePolicy()(state),{throttle:1,turn:0,fire:false});
});

test('GPT-dots still takes a short clean shot before advancing on a crate',()=>{
  const state=observation({
    tanks:[{...A,x:32,y:32},{...B,x:64,y:32}],
    pickups:[{id:'crate',x:96,y:32,type:'gatling'}]
  });
  assert.deepEqual(makePolicy()(state),{throttle:0,turn:0,fire:true});
});

const testZone={x:128,y:128,halfWidth:95,halfHeight:95,initialHalfWidth:128,initialHalfHeight:128,
  finalHalfWidth:64,finalHalfHeight:64,startTick:0,endTick:900,graceTicks:120,outsideTicks:5};

test('GPT-dots abandons unsafe loot to move toward the shrinking rectangle',()=>{
  const obs=observation({
    tick:900,roundTick:900,zone:{...testZone,halfWidth:64,halfHeight:64},
    tanks:[{...A,x:32,y:96,angle:0},{...B,x:220,y:220}],
    pickups:[{id:'loot',x:12,y:96,type:'laser'}]
  });
  const noZone=makePolicy()({...obs,zone:undefined});
  const safe=makePolicy()(obs);
  assert.equal(noZone.throttle,-1);
  assert.deepEqual(safe,{throttle:1,turn:0,fire:false});
  // An invulnerable round survivor need not flee the zone.
  assert.deepEqual(makePolicy()({...obs,tanks:[{...obs.tanks[0],invulnerable:true},obs.tanks[1]]}),noZone);
});

test('GPT-dots anticipates the boundary before the rectangle has started shrinking',()=>{
  const obs=observation({
    tick:62,roundTick:62,zone:{...testZone,halfWidth:128,halfHeight:128,startTick:65,endTick:155},
    tanks:[{...A,x:32,y:96,angle:0},{...B,x:220,y:220}],
    pickups:[{id:'loot',x:12,y:96,type:'laser'}]
  });
  assert.equal(makePolicy()(obs).throttle,1);
});

test('bot returns a safe neutral action without its declared simulation profile',()=>{
  for(const profile of [undefined,{},{...classicProfile(25),forwardSpeed:0}]) {
    assert.deepEqual(makePolicy()(observation({profile})),{throttle:0,turn:0,fire:false});
  }
});

test('GPT-dots fires in motion without abandoning a crate or sending a held-fire repeat',()=>{
  const state=observation({
    tanks:[{...A,x:32,y:32},{...B,x:108,y:32}],
    pickups:[{id:'crate',x:96,y:32,type:'gatling'}]
  });
  assert.deepEqual(makePolicy()(state),{throttle:1,turn:0,fire:true});
  const after={...state,tanks:[{...state.tanks[0],fireHeld:true},state.tanks[1]]};
  assert.deepEqual(makePolicy()(after),{throttle:1,turn:0,fire:false});
});

test('a newly clear close shot can fire without waiting out the aim timer',()=>{
  const profile=classicProfile(60);
  const bearing=0.45;
  const me={...A,x:60,y:60,angle:0};
  const target={...B,x:60+95*Math.cos(bearing),y:60+95*Math.sin(bearing)};
  const choose=makePolicy();
  const state=observation({profile,tanks:[me,target]});
  for(let tick=0;tick<13;tick++) assert.equal(choose({...state,tick,roundTick:tick}).fire,false);
  const clear={...state,tick:13,roundTick:13,tanks:[{...me,angle:bearing},target]};
  assert.equal(choose(clear).fire,true);
});

test('GPT-dots turns to open an escape alongside a wall before a passing shell pins it',()=>{
  const profile=classicProfile(60);
  // Reduced from the live geometry of a replayed loss: turning alongside
  // the wall prepares a move that no constant current-heading dodge finds.
  const obs=observation({
    width:832,height:640,profile,roundTick:132,
    tanks:[{...A,x:307.94,y:210.44,angle:2.18166},{...B,x:289,y:550}],
    walls:[{x1:320,y1:192,x2:320,y2:256}],
    bullets:[{id:'passing',owner:'B',x:292.714,y:240.519,vx:0,vy:-2.4,
      ttl:510,kind:'shell',ownerArmed:true}]
  });
  assert.deepEqual(makePolicy()(obs),{throttle:0,turn:-1,fire:false});
});

test('GPT-dots projects the new laser arc through an interior wall',()=>{
  const profile=classicProfile(60);
  const obs=observation({
    profile,tanks:[{...A,x:32,y:32,angle:0,weapon:'laser'},{...B,x:128,y:35}],
    walls:[{x1:64,y1:0,x2:64,y2:64}]
  });
  assert.equal(makePolicy()(obs).fire,true);
});

test('an alone invulnerable survivor without crates or hazards stays neutral',()=>{
  const obs=observation({tanks:[{...A,invulnerable:true},{...B,alive:false}]});
  assert.deepEqual(makePolicy()(obs),{throttle:0,turn:0,fire:false});
});

test('GPT-dots vetoes a round-wall-tip ricochet before firing but keeps steering',()=>{
  const rate=gameForRate(60);
  const start=rate.init({seed:53,players:['A','B'],config:{cols:4,rows:4}});
  // The line prediction sees a bank shot but the rounded wall endpoint
  // sends the shell back across the launch hull before it can escape.
  start.walls=[{x1:64,y1:0,x2:64,y2:64}];
  Object.assign(start.tanks[0],{x:50,y:68,angle:-Math.PI/36});
  Object.assign(start.tanks[1],{x:113,y:52});
  const decision=makePolicy()(rate.observe(start,'A'));
  assert.deepEqual(decision,{throttle:0,turn:1,fire:false});
  let old=start;const impacts=[];
  for(let i=0;i<7;i++){
    const n=rate.step(old,{A:{throttle:0,turn:0,fire:i===0}});
    old=n.state;impacts.push(...n.events);
  }
  assert.ok(impacts.some(e=>e.type==='destroyed'&&e.tankId==='A'&&e.ownerId==='A'));
  const clean=rate.observe(start,'A');
  clean.walls=[];
  clean.tanks[0].angle=0;
  clean.tanks[1].y=68;
  assert.equal(makePolicy()(clean).fire,true);
});

test('GPT-dots waits before exposing its own hull to an airburst',()=>{
  const profile=classicProfile(60);
  const me={...A,x:24,y:96,weapon:'frag',fragId:'frag-a'};
  const state=observation({
    profile,tanks:[me,{...B,x:128,y:112}],
    bullets:[{id:'frag-a',owner:'A',kind:'frag',x:111,y:96,vx:2.4,vy:0,ttl:100,ownerArmed:true}],
  });
  assert.equal(makePolicy()(state).fire,false);
  const behindWall={...state,walls:[{x1:64,y1:64,x2:64,y2:128}]};
  assert.equal(makePolicy()(behindWall).fire,true);
});
