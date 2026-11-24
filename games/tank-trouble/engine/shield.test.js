import assert from 'node:assert/strict';
import {test} from 'node:test';
import {init,step} from './classic.js';
import {gameForRate} from '../adapter/index.js';

const players=['A','B','C'];
function arena(config={}) {
  const s=init({seed:71,players,config},60);
  s.walls=[];
  for (const [i,t] of s.tanks.entries()) Object.assign(t,{x:100+120*i,y:100,angle:0});
  return s;
}
const tank=(s,id)=>s.tanks.find(t=>t.id===id);
const shell=(id,owner='B',y=100)=>({id,owner,kind:'shell',x:80,y,vx:7,vy:0,ttl:100,ownerArmed:true});

test('a shield is passive and independent of weapon and fire state; a duplicate stays available to others',()=>{
  const s=arena();
  Object.assign(tank(s,'A'),{weapon:'mine',weaponAmmo:2,fireHeld:true});
  s.pickups=[{id:'p1',x:100,y:100,type:'shield'}];
  const fire={throttle:0,turn:0,fire:true};
  const first=step(s,{A:fire});
  assert.deepEqual(first.events,[{type:'pickup',tankId:'A',pickupId:'p1',pickupType:'shield',
    x:100,y:100,activation:'passive',releaseRequired:false}]);
  assert.equal(tank(s,'A').shield,false);
  const self=tank(first.state,'A');
  assert.deepEqual([self.shield,self.weapon,self.weaponAmmo,self.fireHeld],[true,'mine',2,true]);
  assert.equal(gameForRate(60).observe(first.state,'A').tanks[0].shield,true);
  first.state.pickups=[{id:'p2',x:100,y:100,type:'shield'}];
  const blocked=step(first.state,{});
  assert.equal(blocked.state.pickups.length,1);
  assert.equal(blocked.events[0].reason,'shield-already-charged');
  assert.equal(step(blocked.state,{}).events.length,0);
  // B is farther from the crate center, touching its edge, and has a weapon,
  // but remains the sole eligible collector rather than A wasting the crate.
  Object.assign(tank(blocked.state,'B'),{x:121,y:100,weapon:'frag',weaponAmmo:1});
  tank(blocked.state,'A').x=96;
  const second=step(blocked.state,{});
  assert.equal(second.state.pickups.length,0);
  const recipient=tank(second.state,'B');
  assert.deepEqual([recipient.shield,recipient.weapon,recipient.weaponAmmo],[true,'frag',1]);
  assert.equal(second.events[0].tankId,'B');
});

test('one shield consumes one damaging contact in authoritative order, not every contact on a tick',()=>{
  const s=arena();
  tank(s,'A').shield=true;
  s.bullets=[shell('first'),shell('second','C')];
  const result=step(s,{});
  const relevant=result.events.filter(e=>e.tankId==='A');
  assert.deepEqual(relevant.map(e=>[e.type,e.bulletId]),[['shield-block','first'],['hit','second'],['destroyed','second']]);
  assert.deepEqual({...relevant[0],x:undefined},
    {type:'shield-block',tankId:'A',bulletId:'first',ownerId:'B',x:undefined,y:100,kind:'shell'});
  assert(Number.isFinite(relevant[0].x));
  assert.equal(tank(result.state,'A').alive,false);
  assert.equal(tank(result.state,'A').shield,false);
  assert.equal(tank(s,'A').shield,true);
});

test('a continuing beam may spend the charge then damage the same tank on the next tick',()=>{
  const s=arena();
  Object.assign(tank(s,'A'),{weapon:'death-ray',weaponAmmo:1,
    weaponCharge:Math.ceil(s.profile.deathRayCharge)-1,aimAngle:0});
  tank(s,'B').shield=true;
  tank(s,'C').y=250;
  const first=step(s,{});
  const block=first.events.find(e=>e.type==='shield-block');
  assert.equal(block?.tankId,'B');
  assert.equal(block.kind,'death-ray');
  assert.equal(tank(first.state,'B').alive,true);
  const next=step(first.state,{});
  assert.equal(next.events.find(e=>e.type==='destroyed')?.bulletId,block.bulletId);
  assert.equal(tank(next.state,'B').alive,false);
});

test('existing team immunity and invulnerability do not consume a shield',()=>{
  const s=arena({teams:{A:'1',B:'1',C:'2'}});
  tank(s,'A').shield=true;
  s.bullets=[shell('teammate'),shell('enemy','C')];
  const result=step(s,{});
  assert.deepEqual(result.events.filter(e=>e.tankId==='A').map(e=>e.bulletId),['enemy']);
  assert.equal(tank(result.state,'A').alive,true);
  tank(s,'A').invulnerable=true;
  const immune=step(s,{});
  assert.equal(immune.events.some(e=>e.type==='shield-block'),false);
  assert.equal(tank(immune.state,'A').shield,true);
});

test('a zone shield grants a fresh full consecutive-outside grace period without preventing later elimination',()=>{
  const s=arena({shrinkAfterSeconds:0,shrinkDurationSeconds:1,pickups:false});
  s.tick=s.zone.endTick;
  const t=tank(s,'A');
  t.shield=true;
  s.zone.outsideTicks.A=s.zone.graceTicks-1;
  // Keep two other tanks in the zone; no winner immunity should intervene.
  Object.assign(tank(s,'B'),{x:s.zone.x-15,y:s.zone.y});
  Object.assign(tank(s,'C'),{x:s.zone.x+15,y:s.zone.y});
  const grace=s.zone.graceTicks;
  const blocked=step(s,{});
  assert.deepEqual(blocked.events,[{type:'shield-block',tankId:'A',kind:'zone',x:t.x,y:t.y}]);
  assert.equal(blocked.state.zone.outsideTicks.A,0);
  assert.equal(tank(blocked.state,'A').alive,true);
  assert.equal(tank(blocked.state,'A').shield,false);
  let current=blocked.state;
  for(let i=1;i<grace;i++) {
    current=step(current,{}).state;
    assert.equal(tank(current,'A').alive,true);
    assert.equal(current.zone.outsideTicks.A,i);
  }
  assert.equal(step(current,{}).events.find(e=>e.type==='zone-eliminated')?.tankId,'A');
});

test('the default pool includes shields and quick solo first drops remain laser-only',()=>{
  const ordinary=new Set();
  for(let seed=1;seed<129;seed++) {
    for(const classicSolo of [false,true]) {
      const s=init({seed,players,config:{classicSolo,pickupInterval:1}},60);
      const drop=step(s,{}).events.find(e=>e.type==='pickup-spawn');
      assert.ok(drop);
      if(classicSolo) assert.equal(drop.pickupType,'laser');
      else ordinary.add(drop.pickupType);
    }
  }
  assert.equal(ordinary.size,8);
  assert.ok(ordinary.has('shield'));
});
