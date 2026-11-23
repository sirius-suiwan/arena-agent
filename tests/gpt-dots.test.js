import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {makePolicy} from '../bots/gpt-dots/policy.js';
import {game} from '../games/tank-trouble/adapter/index.js';

const A={id:'A',x:60,y:60,angle:0,alive:true,weapon:null};
const B={id:'B',x:165,y:60,angle:Math.PI,alive:true,weapon:null};
const observation=(overrides={})=>({tick:42,round:1,roundTick:42,phase:'playing',
  width:256,height:256,playerId:'A',walls:[],tanks:[A,B],bullets:[],pickups:[],mines:[],shellLimit:10,
  shellSpeed:5.2,...overrides});

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
  const m=[{type:'start',protocol:1,game:'tank-trouble',playerId:'A',rulesVersion:'5'},
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
