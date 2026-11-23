import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as sleep} from 'node:timers/promises';
import {runMatch} from '../core/match.js';
import {MatchPause} from '../core/match-pause.js';
import {jumpGame} from './fixtures/jump-game.js';

test('pause acknowledges a saved tick boundary, holds observations, and resumes without extra simulation ticks',{timeout:2000},async()=>{
  const statuses=[],records=[],observed=[];
  const pause=new MatchPause('demo',status=>statuses.push(status));
  let requested;
  const match=runMatch({
    game:jumpGame,seats:{A:{act:({tick})=>{
      observed.push(tick);
      if (tick===0) requested=pause.setPaused(true);
      return {value:{jump:true}};
    }}},seed:7,maxTicks:3,realtime:true,matchId:'demo',pause,
    record:message=>records.push(message)
  });
  while(!requested) await sleep(1);
  try {
    assert.deepEqual(await requested,{paused:true,tick:1,matchId:'demo'});
    assert.equal(records.at(-1).state.tick,1);
    await sleep(120);
    assert.deepEqual(observed,[0]);
    assert.equal(records.length,2);
    assert.equal(records[0].manifest.matchId,'demo');
  } finally {
    assert.deepEqual(await pause.setPaused(false),{paused:false,tick:1,matchId:'demo'});
  }
  await match;
  assert.deepEqual(observed,[0,1,2]);
  assert.deepEqual(statuses.map(s=>s.paused),[true,false]);
  assert.deepEqual(records.map(r=>r.type),['start','tick','tick','tick','end']);
});

test('overlapping requests are idempotent and match end rejects a pending pause',async()=>{
  const pause=new MatchPause('demo');
  const requested=pause.setPaused(true);
  assert.equal(pause.setPaused(true),requested);
  assert.throws(()=>pause.setPaused(false),/tick/);
  pause.close();
  await assert.rejects(requested,/结束/);
  assert.throws(()=>pause.setPaused(true),/结束/);
});
