import {test} from 'node:test';
import assert from 'node:assert/strict';
import {drawTankFrame} from '../games/tank-trouble/renderer/index.js';

test('mine icons distinguish the pickup badge, deployed body, and triggered warning', () => {
  const draws = [];
  const ctx = new Proxy({}, {
    get: (target, key) => target[key] ?? ((...args) => draws.push([key,...args])),
  });
  const draw = detonateAt => {
    draws.length = 0;
    drawTankFrame({getContext:()=>ctx,getBoundingClientRect:()=>({width:800,height:600})}, {
      width:480,height:360,walls:[],tanks:[],bullets:[],tick:80,roundTick:40,
      pickups:[{x:50,y:50,type:'mine'}],
      mines:[{x:110,y:110,owner:'A',armedAt:20,detonateAt}],
    });
    const placed = draws.findIndex(([op,x,y])=>op==='translate'&&x===110&&y===110);
    assert(placed>0);
    assert(draws.slice(0,placed).some(([op,x])=>op==='roundRect'&&x===-7.2));
    assert(draws.slice(placed).some(([op,x])=>op==='roundRect'&&x===-5.8));
    assert(!draws.slice(placed).some(([op,x])=>op==='roundRect'&&x===-7.2));
    return draws.some(([op,x,y,radius])=>op==='arc'&&x===0&&y===0&&radius===8.1);
  };
  assert.equal(draw(null),false);
  assert.equal(draw(62),true);
});

test('hidden ground mines are not drawn even while the pickup glyph remains visible',()=>{
  const draws=[];
  const ctx=new Proxy({}, {get:(target,key)=>target[key]??((...args)=>draws.push([key,...args]))});
  drawTankFrame({getContext:()=>ctx,getBoundingClientRect:()=>({width:800,height:600})},{
    width:480,height:360,walls:[],tanks:[],bullets:[],tick:80,roundTick:40,
    pickups:[{x:50,y:50,type:'mine'}],
    mines:[{x:110,y:110,owner:'A',armedAt:20,visibility:0}],
  });
  assert(draws.some(([op,x,y])=>op==='translate'&&x===50&&y===50));
  assert(!draws.some(([op,x,y])=>op==='translate'&&x===110&&y===110));
});
