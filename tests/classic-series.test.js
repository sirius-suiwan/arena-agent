import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withClassicSeries} from '../games/tank-trouble/series/index.js';

const simpleRound = {
  id:'fixture',version:'2',tickRate:60,
  init: ({seed,players})=>({tick:0,seed,players}),
  observe:state=>({tick:state.tick}),
  step: (state,{winner})=>({state:{...state,tick:state.tick+1},events:[],result:{winner,reason:'round'}})
};

test('classic series uses a global tick, new seeded rounds and persistent scores',()=>{
  const game=withClassicSeries(simpleRound);
  let state=game.init({seed:2,config:{scoreToWin:2},players:['A','B','C']});
  const beginning=state.seed;
  let next=game.step(state,{winner:'B'});
  assert.equal(next.result,null);
  assert.equal(next.state.phase,'intermission');
  assert.equal(next.events[0].winner,'B');
  assert.equal(next.state.scores.B,1);
  for(let i=0;i<60;i++) next=game.step(next.state,{});
  assert.equal(next.events[0].type,'round-start');
  state=next.state;
  assert.notEqual(state.seed,beginning);
  assert.equal(state.tick,61);
  assert.equal(state.roundTick,0);
  assert.equal(state.scores.B,1);
  assert.equal(game.observe(state,'B').tick,61);
  assert.deepEqual(game.step(state,{winner:'B'}).result,{winner:'B',reason:'score-target',scores:{A:0,B:2,C:0}});
});

test('mutual elimination records a draw without a point',()=>{
  const game=withClassicSeries(simpleRound);
  const state=game.init({seed:2,players:['A','B']});
  const next=game.step(state,{winner:null});
  assert.deepEqual(next.state.scores,{A:0,B:0});
  assert.equal(next.events[0].winner,null);
});
