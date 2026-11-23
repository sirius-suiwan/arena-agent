import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createReplayReconstructor} from '../replay/reconstruct.js';
import {jumpGame} from './fixtures/jump-game.js';

const hash='0'.repeat(64);
const begin={type:'start',manifest:{
  format:2,game:jumpGame.id,rulesVersion:jumpGame.version,tickRate:jumpGame.tickRate,seed:7,players:['A'],maxTicks:1
},hash};
const recorded={type:'shot',tankId:'A',bulletId:'b9',x:42.5,vx:1+Number.EPSILON};
const recomputed={...recorded,vx:1};
const roundEnd={type:'round-end',winner:'A',round:10,scores:{A:1}};
const done={type:'end',result:{winner:null,reason:'tick_limit'}};
const tick={type:'tick',tick:0,hash,input:{A:{submitted:{jump:true},accepted:{jump:true},fallback:null}}};
const game={...jumpGame,step(...args){
  return {...jumpGame.step(...args),events:[recomputed,roundEnd]};
}};
function start(options) {
  const replay=createReplayReconstructor(()=>game,options);
  replay.push(begin);
  return replay;
}

test('playback tolerates runtime rounding but uses the recorded event; strict replay still rejects it',()=>{
  const row={...tick,events:[recorded,roundEnd]};
  const replay=start({mode:'playback'});
  assert.deepEqual(replay.push(row).events,row.events);
  replay.push(done);
  assert.deepEqual(replay.finish(),{ticks:1,result:done.result});
  assert.throws(()=>start().push(row),/tick 0: events differ/);
});

test('playback rejects missing or reordered events, real spatial changes and changed hit attribution or scores',()=>{
  for(const events of [
    [recorded],
    [roundEnd,recorded],
    [{...recorded,tankId:'B'},roundEnd],
    [{...recorded,type:'hit'},roundEnd],
    [{...recorded,vx:recorded.vx+0.01},roundEnd],
    [{...recorded,x:String(recorded.x)},roundEnd],
    [recorded,{...roundEnd,scores:{A:2}}],
    [recorded,{...roundEnd,round:roundEnd.round+1e-9}],
  ]) assert.throws(()=>start({mode:'playback'}).push({...tick,events}),/tick 0: events differ/);
});

test('playback still rejects incorrect results',()=>{
  const replay=start({mode:'playback'});
  replay.push({...tick,events:[recorded,roundEnd]});
  assert.throws(()=>replay.push({type:'end',result:{winner:'A',reason:'tick_limit'}}),/tick 1: result differs/);
});
