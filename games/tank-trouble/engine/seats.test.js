import test from 'node:test';
import assert from 'node:assert/strict';
import {gameForRate} from '../adapter/index.js';

import {init,step} from './classic.js';
const game=gameForRate(60);
const roundGame={init:input=>init(input,60),step};
const eight=Array.from({length:8},(_,i)=>String.fromCharCode(65+i));
const input={seed:'eight-seats',players:eight,config:{cols:4,rows:4}};

test('validates two to eight unique IDs',()=>{
  for (const n of [2,3]) {
    const opts={...input,players:eight.slice(0,n)};
    assert.deepEqual(game.init(opts).tanks.map(t=>t.id),opts.players);
  }
  assert.throws(()=>roundGame.init({...input,players:new Array(2)}),/two to eight/);
  for(const players of [[],['A'],[...'ABCDEFGHI'],['A','A'],['A', ' ']]) {
    assert.throws(()=>game.init({...input,players}),/two to eight/);
  }
});

test('on the smallest maze, eight seeded centers are unique, spaced, and face an open edge',()=>{
  const seed=1;
  for(let i=0;i<9;i++) {
    const data={...input,seed:seed+i};
    const s=game.init(data);
    assert.deepEqual(s,game.init(data));
    assert.equal(s.tanks.length,8);
    const segments=new Set(s.walls.map(w=>[w.x1,w.y1,w.x2,w.y2].join(',')));
    for(const [j,t] of s.tanks.entries()) {
      assert.ok(t.x>=32&&t.y>=32&&t.x<=s.width-32&&t.y<=s.height-32);
      for (let k=j+1;k<s.tanks.length;k++) {
        assert.ok(Math.hypot(t.x-s.tanks[k].x,t.y-s.tanks[k].y)>=64);
      }
      const x=t.x-32,y=t.y-32,heading=Math.round(t.angle/(Math.PI/2));
      const edge=[[x+64,y,x+64,y+64],[x,y+64,x+64,y+64],[x,y,x,y+64],[x,y,x+64,y]][heading];
      assert.ok(!segments.has(edge.join(',')));
    }
    assert.equal(game.observe(s,'H').tanks.length,8);
    assert.deepEqual(Object.keys(s.scores),eight);
  }
});

test('a multi-seat collision pass rewinds all jointly blocked moves',()=>{
  const s=roundGame.init({...input,players:eight.slice(0,4)});
  s.walls=[];
  [[40,50,0],[64.5,50,Math.PI/3],[91,50,Math.PI],[200,100,0]].forEach(([x,y,angle],i)=>
    Object.assign(s.tanks[i],{x,y,angle}));
  const forward={throttle:1,turn:0,fire:false};
  const r=roundGame.step(s,{A:forward,B:forward,C:forward,D:forward});
  assert.deepEqual(r.events,[{type:'tank-stop',tankIds:['A','B','C']}]);
  assert.deepEqual(r.state.tanks.map(t=>t.x),[40,64.5,91,200+128/60]);
});

test('eight seats carry a winner score into a fresh seeded round',()=>{
  let s=game.init({...input,config:{...input.config,scoreToWin:2}});
  const first=s.tanks.map(t=>[t.x,t.y]);
  for(const t of s.tanks) if (t.id!=='H') t.alive=false;
  let r=game.step(s,{});
  assert.equal(r.state.settleUntil,181);
  for(let i=0;i<180;i++)r=game.step(r.state,{});
  assert.equal(r.state.phase,'intermission');
  assert.equal(r.events.find(e=>e.type==='round-end').winner,'H');
  assert.equal(r.state.scores.H,1);
  for(let i=0;i<60;i++)r=game.step(r.state,{});
  assert.equal(r.state.round,2);
  assert.equal(r.state.roundTick,0);
  assert.equal(r.state.scores.H,1);
  assert.equal(r.state.tanks.filter(t=>t.alive).length,8);
  assert.notDeepEqual(r.state.tanks.map(t=>[t.x,t.y]),first);
});
