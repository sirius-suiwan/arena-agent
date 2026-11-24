import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createLaikaPolicy} from '../bots/laika/policy.js';
import {game} from '../games/tank-trouble/adapter/index.js';
import {classicProfile} from '../games/tank-trouble/engine/profile.js';

const me={id:'A',x:40,y:40,angle:0,alive:true,weapon:null};
const enemy={id:'B',x:160,y:40,angle:Math.PI,alive:true,weapon:null};
const ob=(overrides={})=>({tick:4,round:1,roundTick:4,phase:'playing',width:256,height:256,
  playerId:'A',tanks:[me,enemy],walls:[],bullets:[],pickups:[],profile:classicProfile(25),shellSpeed:144/25,shellLimit:10,...overrides});

test('Laika chooses an unobstructed shot and does not hold an edge-triggered weapon',()=>{
  assert.deepEqual(createLaikaPolicy()(ob()),{throttle:0,turn:0,fire:true});
  const held=ob({tanks:[{...me,weapon:'laser',fireHeld:true},enemy]});
  assert.equal(createLaikaPolicy()(held).fire,false);
  assert.equal(createLaikaPolicy()(ob({tanks:[{...me,weapon:'laser',fireHeld:false},enemy]})).fire,true);
});

test('Laika chooses a bank shot when a wall blocks the direct shot',()=>{
  const state=ob({
    width:256,height:256,tanks:[{...me,x:40,y:90,angle:-Math.PI/4},{...enemy,x:176,y:50}],
    walls:[{x1:0,y1:0,x2:256,y2:0},{x1:104,y1:60,x2:104,y2:128}]
  });
  // The shot reflects off the top wall and reaches the enemy to its right.
  assert.equal(createLaikaPolicy()(state).fire,true);
});

test('Laika prioritizes dodging a nearby predicted shell over a shot',()=>{
  const state=ob({bullets:[{owner:'B',x:78,y:40,vx:-5.2,vy:0,ttl:45}]});
  const action=createLaikaPolicy()(state);
  assert.equal(action.fire,false);
  assert.ok(action.throttle!==0||action.turn!==0);
});

test('Laika pursues via a connecting cell instead of turning into a closed edge',()=>{
  const state=ob({tanks:[{...me,x:32,y:32}, {...enemy,x:96,y:32}],
    walls:[{x1:64,y1:0,x2:64,y2:64}]});
  const action=createLaikaPolicy()(state);
  assert.equal(action.fire,false);
  assert.equal(action.turn,1);
});

test('Laika policy is deterministic on a fixed observation stream',()=>{
  const a=createLaikaPolicy(),b=createLaikaPolicy();
  let s=game.init({seed:'laika-fixed',players:['A','B']});
  let moved=false;
  for(let i=0;i<50;i++){
    const obs=game.observe(s,'A');
    const aa=a(obs),bb=b(obs);
    assert.deepEqual(aa,bb);
    game.validateAction(aa);
    moved ||= aa.throttle!==0;
    s=game.step(s,{A:aa,B:{throttle:0,turn:0,fire:false}}).state;
  }
  assert.equal(moved,true);
});

test('Laika Node bot responds with valid JSONL on the host tick and announces its name',()=>{
  const src=[{type:'start',protocol:1,game:'tank-trouble',playerId:'A',rulesVersion:game.version},{
    type:'observe',tick:71,observation:ob()
  }].map(JSON.stringify).join('\n')+'\n';
  const p=spawnSync(process.execPath,['bots/laika/bot.js'],{input:src,encoding:'utf8',timeout:2500});
  assert.equal(p.status,0,p.stderr);
  assert.equal(p.stderr,'');
  const [ready,action]=p.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(ready,{type:'ready',protocol:1,name:'Laika（复刻）'});
  assert.equal(action.type,'action');
  assert.equal(action.tick,71);
  assert.deepEqual(game.validateAction(action.action),action.action);
});

test('bot returns a safe neutral action without its declared simulation profile',()=>{
  for(const profile of [undefined,{},{...classicProfile(25),forwardSpeed:0}]) {
    assert.deepEqual(createLaikaPolicy()(ob({profile})),{throttle:0,turn:0,fire:false});
  }
});

test('Laika steers around a wall end before crossing an otherwise open cell edge',()=>{
  const policy=createLaikaPolicy(),profile=classicProfile(60);
  const wall={x1:64,y1:64,x2:64,y2:128};
  const target={x:96,y:32};
  const distant={...enemy,x:580,y:235};
  let tank={...me,x:51,y:61,angle:Math.atan2(target.y-61,target.x-51)};
  for(let i=0;i<100&&tank.x<75;i++) {
    const action=policy(ob({tick:i,roundTick:i,width:640,profile,tanks:[tank,distant],walls:[wall],pickups:[target]}));
    if(i===0) assert.deepEqual(action,{throttle:0,turn:-1,fire:false});
    const angle=tank.angle+action.turn*profile.turnSpeed;
    const distance=action.throttle*(action.throttle<0?profile.reverseSpeed:profile.forwardSpeed);
    const x=tank.x+distance*Math.cos(angle),y=tank.y+distance*Math.sin(angle);
    assert.ok((x-64)**2+(y-Math.min(128,Math.max(64,y)))**2>=12**2);
    tank={...tank,x,y,angle};
  }
  assert.ok(tank.x>=75,'bot should cross the opening, not just stop safely');
});

test('Laika sidesteps a far incoming laser but keeps the same shot if it is moving away',()=>{
  const profile=classicProfile(60);
  const hull={...me,x:220,y:100,angle:Math.PI/2};
  const other={...enemy,x:220,y:230};
  const beam={kind:'laser',owner:'B',x:20,y:100,heading:0,vx:profile.laserSpeed,vy:0,ttl:19};
  const state=ob({width:384,tanks:[hull,other],profile,bullets:[beam]});
  assert.deepEqual(createLaikaPolicy()(state),{throttle:1,turn:0,fire:false});
  const away={...beam,heading:Math.PI,vx:-beam.vx};
  assert.deepEqual(createLaikaPolicy()({...state,bullets:[away]}),{throttle:0,turn:0,fire:true});
});
