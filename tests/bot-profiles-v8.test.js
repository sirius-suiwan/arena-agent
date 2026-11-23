import test from 'node:test';
import assert from 'node:assert/strict';
import {classicProfile} from '../games/tank-trouble/engine/profile-v8.js';
import {makePolicy} from '../bots/gpt-dots/policy.js';
import {createLaikaPolicy} from '../bots/laika/policy.js';

const bots=Object.entries({'GPT-dots':makePolicy,Laika:createLaikaPolicy});
const A={id:'A',x:60,y:60,angle:0,weapon:null,alive:true,fireHeld:false};
const B={id:'B',x:145,y:60,angle:Math.PI,weapon:null,alive:true,fireHeld:false};
function observe(rate,self=A,foe=B,bullets=[]) {
  return {tick:42,round:1,roundTick:42,phase:'playing',width:256,height:256,playerId:'A',
    walls:[],tanks:[self,foe],bullets,pickups:[],mines:[],
    shellLimit:10,shellSpeed:5.2,profile:classicProfile(rate)};
}

for (const [name,policy] of bots) {
  test(`${name} releases ordinary fire and respects the Classic shell cap at every tick rate`,()=>{
    for (const rate of [25,30,60]) {
      const step=policy();
      assert.equal(step(observe(rate)).fire,true);
      assert.equal(step(observe(rate,{...A,fireHeld:true})).fire,false);
      assert.equal(step(observe(rate)).fire,true);
      const live=Array.from({length:10},(_,i)=>({id:'b'+i,kind:'shell',owner:'A',x:225,y:230,vx:2,vy:0,ttl:100}));
      assert.equal(step(observe(rate,A,B,live.slice(1))).fire,true);
      assert.equal(step(observe(rate,A,B,live)).fire,false);
    }
  });

  test(`${name} keeps Gatling held through the burst, releases when empty, and steers an active RC missile`,()=>{
    const gatling={...A,weapon:'gatling',weaponCharge:1,weaponAmmo:20,fireHeld:true};
    assert.equal(policy()(observe(25,gatling)).fire,true);
    assert.equal(policy()(observe(25,{...gatling,weaponAmmo:0})).fire,false);
    const remote={...A,weapon:'remote',fragId:'rc',fireHeld:true};
    const missile={id:'rc',kind:'remote',owner:'A',x:110,y:70,vx:5.76,vy:0,ttl:200,ownerArmed:true};
    assert.deepEqual(policy()(observe(25,remote,{...B,y:155},[missile])),{throttle:0,turn:1,fire:false});
  });

  test(`${name} does not manufacture a new fire edge during an automatic Death Ray charge`,()=>{
    const me={...A,weapon:'death-ray',weaponCharge:3,fireHeld:false};
    assert.equal(policy()(observe(25,me)).fire,false);
  });
}
