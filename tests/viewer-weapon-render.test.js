import {test} from 'node:test';
import assert from 'node:assert/strict';
import {drawTankFrame} from '../games/tank-trouble/renderer/index.js';

const path = [{x:20,y:30},{x:31,y:33},{x:40,y:40}];
const trail = {type:'laser-path',bulletId:'light',ownerId:'A',path};

function draw(bullets, effects = []) {
  const operations = [];
  const context = new Proxy({}, {
    get: (target, key) => target[key] ?? ((...args) => operations.push([key,...args])),
  });
  const state = {width:480,height:360,walls:[],tanks:[],pickups:[],bullets,profile:{render:{gatlingRadius:1.35}}};
  drawTankFrame({getContext:()=>context,getBoundingClientRect:()=>({width:800,height:600})}, state, {effects});
  return operations;
}

test('laser uses authored bends, drawing a single trail in active and terminal frames', () => {
  const laser = {id:'light',owner:'A',kind:'laser',x:40,y:40,vx:5,vy:3,path};
  for (const projectiles of [[laser], []]) {
    const operations = draw(projectiles, [{event:trail,age:0}]);
    assert.deepEqual(operations.filter(([op,x]) => op==='lineTo' && [31,40].includes(x)), [
      ['lineTo',31,33], ['lineTo',40,40],
    ]);
  }
  assert(!draw([], [{event:trail,age:2}]).some(([op,x]) => op==='lineTo' && x===31));
});

test('Gatling pellets remain smaller than shells in the same frame', () => {
  const operations = draw([{kind:'gatling',x:20,y:30},{kind:'shell',x:40,y:50}]);
  const arcs = operations.filter(([op]) => op==='arc');
  assert.equal(arcs.find(([,x])=>x===20)[3], 1.35);
  assert.equal(arcs.find(([,x])=>x===40)[3], 3);
});

test('a cosmetic shard fades after a wall stop without needing a live projectile',()=>{
  const e={type:'shell-expired',kind:'shrapnel',reason:'wall',ownerId:'A',x:13,y:17};
  const drawn=age=>draw([], [{event:e,age}]).some(([op,x])=>op==='arc'&&x===13);
  assert.equal(drawn(15),true);
  assert.equal(drawn(48),false);
});
