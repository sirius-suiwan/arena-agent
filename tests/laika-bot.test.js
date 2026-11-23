import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createLaikaPolicy} from '../bots/laika/policy.js';
import {game} from '../games/tank-trouble/adapter/index.js';

const me={id:'A',x:40,y:40,angle:0,alive:true,weapon:null};
const enemy={id:'B',x:160,y:40,angle:Math.PI,alive:true,weapon:null};
const ob=(overrides={})=>({tick:4,round:1,roundTick:4,phase:'playing',width:256,height:256,
  playerId:'A',tanks:[me,enemy],walls:[],bullets:[],pickups:[],shellSpeed:5.2,shellLimit:10,...overrides});

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
  const src=[{type:'start',protocol:1,game:'tank-trouble',playerId:'A',rulesVersion:'4'},{
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
