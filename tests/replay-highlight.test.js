import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexLethalProjectiles,lethalProjectileRings} from '../viewer/replay-highlight.js';

const frame=(round,bullets=[],events=[])=>({state:{round,bullets},events});
const bullet=(id,x,y,owner='A')=>({id,x,y,owner});

test('a small ring follows only a future lethal projectile, during playback and on impact',()=>{
  const hit={type:'hit',bulletId:'b1',tankId:'A',ownerId:'A',x:4,y:3};
  const destroyed={type:'destroyed',bulletId:'b1',tankId:'A',ownerId:'A'};
  const frames=[
    frame(1,[bullet('b1',90,90)]),
    frame(2,[bullet('b1',1,2),bullet('b2',6,6,'B')]),
    frame(2,[bullet('b1',8,3),bullet('b2',7,6,'B')]),
    frame(2,[bullet('b2',8,6,'B')],[hit,destroyed]),
    frame(2,[bullet('b2',9,6,'B')]),
    frame(3,[bullet('b1',30,30)])
  ];
  const index=indexLethalProjectiles(frames);
  assert.deepEqual(frames.map((f,i)=>lethalProjectileRings(index,f,i)),[
    [],[{x:1,y:2,ownerId:'A'}],[{x:8,y:3,ownerId:'A'}],[{x:4,y:3,ownerId:'A'}],[],[]
  ]);
  assert.deepEqual(lethalProjectileRings(null,frames[1],1),[]);
});

test('an absorbed shot is not lethal and an instant ray only marks its actual impact',()=>{
  const frames=[frame(undefined,[bullet('b1',1,2)],[{type:'hit',absorbed:true,bulletId:'b1',x:2,y:3}]),
    frame(undefined,[],[{type:'destroyed',bulletId:'ray',tankId:'B',ownerId:'A'},
      {type:'hit',bulletId:'ray',tankId:'B',x:6,y:7}])];
  const index=indexLethalProjectiles(frames);
  assert.deepEqual(lethalProjectileRings(index,frames[0],0),[]);
  assert.deepEqual(lethalProjectileRings(index,frames[1],1),[{x:6,y:7,ownerId:'A'}]);
});
