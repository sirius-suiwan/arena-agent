import {test} from 'node:test';
import assert from 'node:assert/strict';
import {killHighlight} from '../viewer/replay-highlight.js';

const frame=(round,events=[],bullets=[])=>({state:{round,bullets,tanks:[]},events});

test('marks the actual ricochet kill and ignores the last round’s reused projectile ID',()=>{
  const killed={type:'destroyed',bulletId:'b1',tankId:'A',ownerId:'A'};
  const hit={type:'hit',bulletId:'b1',tankId:'A',ownerId:'A',x:4,y:3};
  const frames=[
    frame(1,[{type:'shot',bulletId:'b1',x:90,y:90}]),
    frame(2,[{type:'shot',bulletId:'b1',tankId:'A',x:1,y:2}],[{id:'b1',x:3,y:2}]),
    frame(2,[{type:'bounce',bulletId:'b1',x:8,y:2}],[{id:'b1',x:7,y:2.5}]),
    frame(2,[hit,killed])
  ];
  assert.deepEqual(killHighlight(frames,3,killed),{
    ownerId:'A',bulletId:'b1',points:[{x:1,y:2},{x:3,y:2},{x:8,y:2},{x:7,y:2.5},{x:4,y:3}],
    hit:{x:4,y:3},selfHit:true
  });
  assert.equal(killHighlight(frames,3,hit),null);
});

test('preserves a recorded beam path and marks its impact separately',()=>{
  const killed={type:'destroyed',bulletId:'b3',tankId:'B',ownerId:'A'};
  const path=[{x:2,y:4},{x:8,y:4},{x:5,y:8}];
  const frames=[frame(1,[
    {type:'weapon-fired',weapon:'laser',bulletId:'b3',path},
    {type:'hit',bulletId:'b3',tankId:'B',x:6,y:7},killed
  ])];
  const result=killHighlight(frames,0,killed);
  assert.deepEqual(result.points,path);
  assert.deepEqual(result.hit,{x:6,y:7});
  assert.equal(result.selfHit,false);
});
