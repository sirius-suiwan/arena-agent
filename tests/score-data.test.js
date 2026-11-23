import {test} from 'node:test';
import assert from 'node:assert/strict';
import {availableShellSlots,countKills,emptyKillTotals} from '../viewer/score-data.js';

test('presentation kills count opposing eliminations once, not self-hits',()=>{
  const kills=emptyKillTotals(['A','B','C']);
  const events=[
    {type:'hit',ownerId:'A',tankId:'B'},
    {type:'destroyed',ownerId:'A',tankId:'B'},
    {type:'destroyed',ownerId:'A',tankId:'B'},
    {type:'destroyed',ownerId:'C',tankId:'C'}
  ];
  assert.deepEqual(countKills(kills,events),{A:1,B:0,C:0});
  assert.deepEqual(kills,{A:0,B:0,C:0});
});

test('friendly-fire eliminations never count in the opposing kill tally',()=>{
  const kills=emptyKillTotals(['A','B','C']);
  assert.deepEqual(countKills(kills,[
    {type:'destroyed',ownerId:'A',tankId:'B'},
    {type:'destroyed',ownerId:'A',tankId:'C'},
    {type:'zone-eliminated',tankId:'A'}
  ],{A:'1',B:'1',C:'2'}),{A:1,B:0,C:0});
});

test('ammunition meter counts only live normal shells',()=>{
  const bullets=[{owner:'A',kind:'shell'},{owner:'A',kind:'frag'},{owner:'B',kind:'shell'}];
  assert.deepEqual(availableShellSlots({shellLimit:10,bullets},'A'),{limit:10,available:9});
  assert.deepEqual(availableShellSlots({shellLimit:10,bullets:bullets.slice(1)},'A'),{limit:10,available:10});
});
