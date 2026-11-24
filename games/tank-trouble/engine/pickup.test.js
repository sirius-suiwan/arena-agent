import test from 'node:test';
import assert from 'node:assert/strict';
import {gameForRate} from '../adapter/index.js';

const game=gameForRate(60);
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

test('defaults to a 12×9 connected maze and permits custom size',()=>{
  const s=game.init(input);
  assert.deepEqual([s.width,s.height],[768,576]);
  assert.deepEqual([game.init({...input,config:{cols:16}}).width,game.init({...input,config:{rows:12}}).height],[1024,768]);
  assert.throws(()=>game.init({...input,config:{cols:17}}),/cols/);
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

test('collects a crate on diagonal overlap',()=>{
  const crate=[[114,114.5,'gatling']];
  const current=game.step(mock(game,crate),{});
  assert.equal(current.state.pickups.length,0);
  assert.equal(current.state.tanks[0].weapon,'gatling');
  assert.deepEqual(current.events[0],{type:'pickup',tankId:'amber',pickupId:'p1',pickupType:'gatling',
    x:114,y:114.5,weaponAmmo:20,activation:'hold',releaseRequired:false});
});

test('an occupied slot reports once per contact, then a used weapon frees its slot for pickup',()=>{
  const s=mock(game,[[100,100,'frag']]);
  Object.assign(s.tanks[0],{weapon:'laser',weaponAmmo:1});
  const first=game.step(s,{});
  assert.deepEqual(first.events,[{type:'pickup-blocked',tankId:'amber',pickupId:'p1',pickupType:'frag',
    heldWeapon:'laser',reason:'weapon-slot-occupied',x:100,y:100}]);
  assert.deepEqual(game.observe(first.state,'amber').pickupBlocks,[{tankId:'amber',pickupId:'p1'}]);
  assert.deepEqual(game.step(first.state,{}).events,[]);
  const away=structuredClone(first.state);
  away.tanks[0].x=140;
  const cleared=game.step(away,{});
  assert.deepEqual(cleared.state.pickupBlocks,[]);
  cleared.state.tanks[0].x=100;
  const again=game.step(cleared.state,{});
  assert.equal(again.events[0].type,'pickup-blocked');
  let released=game.step(first.state,{amber:act(true)});
  assert.equal(released.state.tanks[0].weapon,'laser');
  while(released.state.tanks[0].weapon==='laser') released=game.step(released.state,{amber:act(true)});
  const pickup=released.events.find(e=>e.type==='pickup');
  assert.equal(released.state.tanks[0].weapon,'frag');
  assert.equal(pickup.activation,'press');
  assert.equal(pickup.releaseRequired,true);
  assert.deepEqual(released.state.pickupBlocks,[]);
  const stillHeld=game.step(released.state,{amber:act(true)});
  assert.equal(stillHeld.state.tanks[0].fragId,null);
  const release=game.step(stillHeld.state,{amber:act(false)});
  const pressed=game.step(release.state,{amber:act(true)});
  assert.equal(pressed.events.find(e=>e.type==='shot')?.kind,'frag');
});

test('the last survivor may collect existing crates but settlement does not spawn new ones',()=>{
  const s=mock(game,[[100,100,'mine']]);
  s.tanks[1].alive=false;
  s.config.pickupInterval=1;
  const r=game.step(s,{});
  assert.equal(r.state.settleUntil,181);
  assert.equal(r.state.tanks[0].weapon,'mine');
  assert.equal(r.state.pickups.length,0);
  assert.deepEqual(r.events.map(e=>e.type),['last-tank-pending','pickup']);
  assert.deepEqual(game.step(r.state,{}).events,[]);
});
