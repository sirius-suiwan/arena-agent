import test from 'node:test';
import assert from 'node:assert/strict';
import {classicRoundGameV3 as v3,classicRoundGame as v2,game,gameV2} from '../adapter/index.js';

const act=(fire=false)=>({throttle:0,turn:0,fire});
const input={seed:'pickup-regression',players:['amber','blue']};
const mock=(g,spots) => {
  const s=g.init({...input,config:{pickupInterval:360}});
  s.walls=[];
  Object.assign(s.tanks[0],{x:100,y:100,angle:0});
  Object.assign(s.tanks[1],{x:300,y:250,angle:0});
  s.pickups=spots.map(([x,y,type],i)=>({id:'p'+(i+1),x,y,type}));
  return s;
};

test('v3 defaults to a 12×9 connected maze, permits custom size, and v2 retains old size and state shape',()=>{
  const s=game.init(input);
  assert.equal(game.version,'3');
  assert.deepEqual([s.width,s.height],[768,576]);
  assert.deepEqual([gameV2.init(input).width,gameV2.init(input).height],[512,384]);
  assert.equal(Object.hasOwn(gameV2.init(input),'pickupBlocks'),false);
  assert.deepEqual([game.init({...input,config:{cols:16}}).width,game.init({...input,config:{rows:12}}).height],[1024,768]);
  assert.throws(()=>v3.init({...input,config:{cols:17}}),/cols/);
  const {cols,rows}=s.config;
  const boundaries=new Set(s.walls.map(w=>[w.x1,w.y1,w.x2,w.y2].join(',')));
  const visited=new Set([0]), queue=[0];
  while(queue.length) {
    const i=queue.pop(),x=i%cols,y=Math.floor(i/cols),cx=x*64,cy=y*64;
    const adjacent=[
      [i-1,x>0,[cx,cy,cx,cy+64]],[i+1,x<cols-1,[cx+64,cy,cx+64,cy+64]],
      [i-cols,y>0,[cx,cy,cx+64,cy]],[i+cols,y<rows-1,[cx,cy+64,cx+64,cy+64]]
    ];
    for (const [n,inside,sep] of adjacent) if (inside&&!visited.has(n)&&!boundaries.has(sep.join(','))) {
      visited.add(n);queue.push(n);
    }
  }
  assert.equal(visited.size,108);
});

test('a diagonal visible crate overlap missed by v2 is collected in v3',()=>{
  const crate=[[114,114.5,'gatling']];
  const old=v2.step(mock(v2,crate),{});
  assert.equal(old.state.pickups.length,1);
  const current=v3.step(mock(v3,crate),{});
  assert.equal(current.state.pickups.length,0);
  assert.equal(current.state.tanks[0].weapon,'gatling');
  assert.deepEqual(current.events[0],{type:'pickup',tankId:'amber',pickupId:'p1',pickupType:'gatling',
    x:114,y:114.5,weaponAmmo:18,activation:'hold',releaseRequired:false});
});

test('an occupied slot reports once per contact, then a used weapon frees its slot for pickup',()=>{
  const s=mock(v3,[[100,100,'frag']]);
  Object.assign(s.tanks[0],{weapon:'laser',weaponAmmo:1});
  const first=v3.step(s,{});
  assert.deepEqual(first.events,[{type:'pickup-blocked',tankId:'amber',pickupId:'p1',pickupType:'frag',
    heldWeapon:'laser',reason:'weapon-slot-occupied',x:100,y:100}]);
  assert.deepEqual(v3.observe(first.state,'amber').pickupBlocks,[{tankId:'amber',pickupId:'p1'}]);
  assert.deepEqual(v3.step(first.state,{}).events,[]);
  const away=structuredClone(first.state);
  away.tanks[0].x=140;
  const cleared=v3.step(away,{});
  assert.deepEqual(cleared.state.pickupBlocks,[]);
  cleared.state.tanks[0].x=100;
  const again=v3.step(cleared.state,{});
  assert.equal(again.events[0].type,'pickup-blocked');
  const released=v3.step(first.state,{amber:act(true)});
  const pickup=released.events.find(e=>e.type==='pickup');
  assert.equal(released.state.tanks[0].weapon,'frag');
  assert.equal(pickup.activation,'press');
  assert.equal(pickup.releaseRequired,true);
  assert.deepEqual(released.state.pickupBlocks,[]);
  const stillHeld=v3.step(released.state,{amber:act(true)});
  assert.equal(stillHeld.state.tanks[0].fragId,null);
  const release=v3.step(stillHeld.state,{amber:act(false)});
  const pressed=v3.step(release.state,{amber:act(true)});
  assert.equal(pressed.events.find(e=>e.type==='shot')?.kind,'frag');
});

test('the last survivor may collect existing crates but settlement does not spawn new ones',()=>{
  const s=mock(v3,[[100,100,'mine']]);
  s.tanks[1].alive=false;
  s.config.pickupInterval=1;
  const r=v3.step(s,{});
  assert.equal(r.state.settleUntil,181);
  assert.equal(r.state.tanks[0].weapon,'mine');
  assert.equal(r.state.pickups.length,0);
  assert.deepEqual(r.events.map(e=>e.type),['last-tank-pending','pickup']);
  assert.deepEqual(v3.step(r.state,{}).events,[]);
});
