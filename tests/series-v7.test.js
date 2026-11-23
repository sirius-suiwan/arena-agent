import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withClassicSeriesV7,withClassicSeries} from '../games/tank-trouble/series/index.js';

const rounds={
  id:'series-fixture',version:'7',tickRate:60,
  init:({seed,config,players})=>({tick:0,seed,config,players}),
  observe:(state,playerId)=>({tick:state.tick,playerId,teams:state.config.teams}),
  roundTickLimit:config=>config.maxTicks??((config.shrinkAfterSeconds??40)+(config.shrinkDurationSeconds??15)+5)*60,
  matchTickLimit:config=> (config.maxTicks??3600)*3,
  step:(state,{winner=null,winnerTeam,play=false})=>({
    state:{...state,tick:state.tick+1},events:[],
    result:play?null:{winner,...(winnerTeam!==undefined?{winnerTeam}:{}),reason:winnerTeam?'last-team':winner?'last-tank':'timeout'}
  })
};
const v7=withClassicSeriesV7(rounds);
const nextRound=(game,state)=>{
  let latest;
  for(let i=0;i<60;i++){
    latest=game.step(state,{});state=latest.state;
  }
  return latest;
};

test('fixed series counts draws, ignores score target and ends after exactly N rounds',()=>{
  let s=v7.init({seed:7,config:{roundLimit:3,scoreToWin:1},players:['A','B']});
  assert.equal(s.roundLimit,3);
  assert.deepEqual(s.config,{});
  let r=v7.step(s,{winner:'A'});
  assert.equal(r.result,null);
  assert.deepEqual(r.events,[{type:'round-end',round:1,winner:'A',scores:{A:1,B:0},reason:'last-tank'}]);
  r=nextRound(v7,r.state);
  assert.equal(r.state.round,2);
  assert.equal(r.state.seed,'[7,2]');
  r=v7.step(r.state,{});
  assert.equal(r.result,null);
  assert.equal(r.events[0].winner,null);
  r=nextRound(v7,r.state);
  assert.equal(r.state.round,3);
  r=v7.step(r.state,{});
  assert.deepEqual(r.result,{winner:'A',reason:'round-limit',scores:{A:1,B:0}});
  assert.equal(r.state.phase,'finished');
  assert.throws(()=>v7.step(r.state,{}),/finished/);
});

test('a tied fixed series draws and omitted/zero limits keep first-to-target',()=>{
  let r=v7.step(v7.init({seed:7,config:{roundLimit:2},players:['A','B']}),{winner:'A'});
  r=v7.step(nextRound(v7,r.state).state,{winner:'B'});
  assert.deepEqual(r.result,{winner:null,reason:'round-limit',scores:{A:1,B:1}});
  for(const roundLimit of [undefined,0]) {
    r=v7.step(v7.init({seed:1,config:{roundLimit,scoreToWin:1},players:['A','B']}),{winner:'B'});
    assert.deepEqual(r.result,{winner:'B',reason:'score-target',scores:{A:0,B:1}});
  }
});

test('fixed teams earn one point per round, keep roster, and expose scores and team winners',()=>{
  const teams={A:'1',B:'1',C:'4',D:'4'};
  let s=v7.init({seed:0,players:[...'ABCD'],config:{teams,roundLimit:3,scoreToWin:1,friendlyFire:true}});
  assert.deepEqual(s.config,{teams,friendlyFire:true});
  let r=v7.step(s,{winnerTeam:'4'});
  const individual={A:0,B:0,C:0,D:0};
  assert.equal(r.result,null);
  assert.equal(r.state.roundWinnerTeam,'4');
  assert.deepEqual(r.events[0],{type:'round-end',round:1,winner:null,winnerTeam:'4',teamScores:{'1':0,'4':1},
    scores:individual,reason:'last-team'});
  assert.deepEqual(v7.observe(r.state,'C').teamScores,{'1':0,'4':1});
  assert.equal(v7.observe(r.state,'C').roundWinnerTeam,'4');
  r=nextRound(v7,r.state);
  assert.equal(r.state.roundWinnerTeam,null);
  assert.deepEqual(r.state.config.teams,teams);
  assert.deepEqual(r.events[0].teamScores,{'1':0,'4':1});
  r=v7.step(r.state,{winnerTeam:'1'});
  assert.equal(r.result,null);
  r=v7.step(nextRound(v7,r.state).state,{winnerTeam:'4'});
  assert.deepEqual(r.result,{winner:null,winnerTeam:'4',reason:'round-limit',scores:individual,teamScores:{'1':1,'4':2}});
});

test('fixed team ties draw, and score-target team wins keep winnerTeam distinct from a seat',()=>{
  const common={seed:1,players:['A','B'],config:{teams:{A:'2',B:'4'}}};
  let r=v7.step(v7.init({...common,config:{...common.config,roundLimit:1}}),{});
  assert.deepEqual(r.result,{winner:null,winnerTeam:null,reason:'round-limit',scores:{A:0,B:0},teamScores:{'2':0,'4':0}});
  r=v7.step(v7.init({...common,config:{...common.config,scoreToWin:1}}),{winnerTeam:'2'});
  assert.deepEqual(r.result,{winner:null,winnerTeam:'2',reason:'score-target',scores:{A:0,B:0},teamScores:{'2':1,'4':0}});
  assert.throws(()=>v7.step(v7.init(common),{winner:'A'}),/invalid round winner/);
});

test('validates complete team assignments, enabled team count and round limit',()=>{
  const common={seed:3,players:['A','B']};
  for(const teams of [null,{A:'1'},{A:'1',B:'2',C:'3'},{A:'1',C:'2'},{A:'1',B:'5'},{A:1,B:'2'}]) {
    assert.throws(()=>v7.init({...common,config:{teams}}),/assign every active seat/);
  }
  assert.throws(()=>v7.init({...common,config:{teams:{A:'1',B:'1'}}}),/at least two distinct teams/);
  for(const roundLimit of [-1,21,1.5,null,'2']) {
    assert.throws(()=>v7.init({...common,config:{roundLimit}}),/roundLimit/);
  }
});

test('host tick bound uses the normalized round timeout plus settlement and breaks; legacy wrapper unchanged',()=>{
  assert.equal(v7.matchTickLimit({roundLimit:3,maxTicks:100}),3*(100+180)+2*60);
  assert.equal(v7.matchTickLimit({roundLimit:2,shrinkAfterSeconds:20,shrinkDurationSeconds:40}),2*(3900+180)+60);
  assert.equal(v7.matchTickLimit({}),10800);
  const old=withClassicSeries(rounds);
  const state=old.init({seed:10,config:{scoreToWin:1},players:['A','B']});
  assert.equal(Object.hasOwn(state,'roundLimit'),false);
  assert.equal(Object.hasOwn(state,'teamScores'),false);
  assert.deepEqual(old.step(state,{winner:'B'}).result,{winner:'B',reason:'score-target',scores:{A:0,B:1}});
});
