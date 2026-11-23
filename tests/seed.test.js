import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomMatchSeed} from '../apps/cli/seed.js';

test('automatic seeds are unique in the host and fit the replayable form range',()=>{
  const values=Array.from({length:1001},()=>randomMatchSeed());
  assert.equal(new Set(values).size,values.length);
  assert.ok(values.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff));
});
