import {test} from 'node:test';
import assert from 'node:assert/strict';
import {drawTankFrame,formatTankEvent,tankWeaponLabel} from '../games/tank-trouble/renderer/index.js';

test('shield charge and block use distinct stage marks and an identifiable crate icon',()=>{
  const ops=[];
  const ctx=new Proxy({}, {get:(target,key)=>target[key]??((...args)=>ops.push([key,...args]))});
  const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({width:480,height:360})};
  const tank={id:'A',alive:true,x:120,y:150,angle:0,shield:true};
  const arena={width:480,height:360,walls:[],tanks:[tank],bullets:[],pickups:[{x:160,y:150,type:'shield'}]};
  drawTankFrame(canvas,arena);
  assert(ops.some(([cmd,x,y,r])=>cmd==='arc'&&x===0&&y===0&&r===15.5));
  assert(ops.some(([cmd,x,y])=>cmd==='moveTo'&&x===0&&y===-4.8));
  ops.length=0;
  const event={type:'shield-block',tankId:'A',kind:'zone',x:120,y:150};
  drawTankFrame(canvas,{...arena,tanks:[{...tank,shield:false}]},{effects:[{event,age:0}]});
  assert(!ops.some(([cmd,x,y,r])=>cmd==='arc'&&x===0&&y===0&&r===15.5));
  assert(ops.some(([cmd,x,y,r])=>cmd==='arc'&&x===120&&y===150&&r===17));
  assert.equal(tankWeaponLabel('shield'),'护盾');
  assert.match(formatTankEvent(event),/护盾抵消伤害.*目标 A.*安全区外伤害/);
});
