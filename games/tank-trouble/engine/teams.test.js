import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gameForRate,validateTeams} from '../adapter/index.js';

import {init,step} from './classic.js';
const game=gameForRate(60);
const roundGame={init:input=>init(input,60),step,observe:(...args)=>game.observe(...args)};
const players=['A','B','D'], teams={A:'1',B:'1',D:'4'};
const neutral={throttle:0,turn:0,fire:false};
const fire={...neutral,fire:true};
const setup=(config={},positions=[60,100,140])=>{
  const s=roundGame.init({seed:91,config:{pickups:false,teams,...config},players});
  return {...s,walls:[],tanks:s.tanks.map((t,i)=>({...t,x:positions[i],y:80,angle:0}))};
};
const shot=(owner,x,vx,kind='shell')=>({id:'shot',owner,kind,x,y:80,vx,vy:0,ttl:60,ownerArmed:true});
const tank=(s,id)=>s.tanks.find(t=>t.id===id);
const weapon=(s,id,props)=>({...s,tanks:s.tanks.map(t=>t.id===id?{...t,...props}:t)});

test('validates complete sparse, detached team assignments and toggle types',()=>{
  assert.equal(validateTeams(undefined,players),undefined);
  const labels=validateTeams(teams,players);
  labels.A='2';
  assert.equal(teams.A,'1');
  for(const assignment of [null,[],{}, {A:'1',B:'1',D:'1'}, {A:'1',B:'1',D:4},
    {A:'1',B:'1',C:'4'}, {A:'1',B:'1',D:'5'}, {A:'1',B:'1',D:'4',H:'4'}]){
    assert.throws(()=>roundGame.init({seed:1,players,config:{teams:assignment}}),/teams/);
  }
  assert.throws(()=>roundGame.init({seed:1,players,config:{friendlyFire:'false'}}),/friendlyFire/);
  assert.throws(()=>roundGame.init({seed:1,players,config:{mazeComplexity:'constructor'}}),/mazeComplexity/);
  const s=roundGame.init({seed:1,players,config:{teams}});
  const obs=game.observe(game.init({seed:1,players,config:{teams}}),'A');
  assert.deepEqual(obs.teams,teams);
  assert.equal(obs.friendlyFire,false);
  obs.teams.A='2';
  assert.equal(s.teams.A,'1');
  assert.equal(teams.A,'1');
  assert(!Object.hasOwn(roundGame.init({seed:1,players}).config,'teams'));
});

test('all maze densities are seeded and connected',()=>{
  const input={seed:91,players};
  const make=mazeComplexity=>roundGame.init({...input,config:{mazeComplexity}});
  for(const mode of ['open','classic','dense']){
    const s=make(mode);
    assert.deepEqual(make(mode),s);
    const wall=new Set(s.walls.map(w=>[w.x1,w.y1,w.x2,w.y2].join(',')));
    const cols=s.config.cols,rows=s.config.rows;
    const seen=new Set([0]), queue=[0];
    for(let i=0;i<queue.length;i++){
      const here=queue[i], col=here%cols,row=Math.floor(here/cols);
      const x=col*64,y=row*64;
      const steps=[
        [col>0,here-1,[x,y,x,y+64]],
        [col+1<cols,here+1,[x+64,y,x+64,y+64]],
        [row>0,here-cols,[x,y,x+64,y]],
        [row+1<rows,here+cols,[x,y+64,x+64,y+64]]
      ];
      for(const [valid,next,edge] of steps)if(valid&&!seen.has(next)&&!wall.has(edge.join(','))){seen.add(next);queue.push(next);}
    }
    assert.equal(seen.size,cols*rows);
  }
  assert(make('open').walls.length<make('classic').walls.length);
  assert(make('classic').walls.length<make('dense').walls.length);
});

test('teammates do not block ordinary shells, fragments or lasers with friendly fire disabled',()=>{
  for(const kind of ['shell','shrapnel','gatling']){
    const s=setup();
    const r=roundGame.step({...s,bullets:[shot('A',80,60,kind)]},{});
    assert.equal(tank(r.state,'B').alive,true);
    assert.equal(tank(r.state,'D').alive,false);
  }
  const s=weapon(setup(),'A',{weapon:'laser',weaponAmmo:1});
  let r=roundGame.step(s,{A:fire});
  for(let i=0;i<2&&!r.events.some(e=>e.type==='hit');i++) r=roundGame.step(r.state,{});
  assert.equal(tank(r.state,'B').alive,true);
  assert.equal(tank(r.state,'D').alive,false);
  assert.equal(r.events.find(e=>e.type==='hit')?.kind,'laser');
});

test('friendly fire enables teammate hits, while self-damage remains possible with it disabled',()=>{
  const on=setup({friendlyFire:true});
  const hit=roundGame.step({...on,bullets:[shot('A',80,60)]},{});
  assert.equal(tank(hit.state,'B').alive,false);
  assert.equal(tank(hit.state,'D').alive,true);
  const off=setup();
  const self=roundGame.step({...off,bullets:[shot('A',42,6)]},{});
  assert.equal(tank(self.state,'A').alive,false);
  assert.equal(tank(self.state,'B').alive,true);
  assert(self.events.some(e=>e.type==='hit'&&e.ownerId==='A'&&e.tankId==='A'));
});

test('enemy beams can hit through teammates and allied tanks cannot trigger / be hurt by mines',()=>{
  const deathray=weapon(setup(),'A',{weapon:'death-ray',weaponAmmo:1,weaponCharge:35,aimAngle:0});
  const beam=roundGame.step(deathray,{A:fire});
  assert.equal(tank(beam.state,'B').alive,true);
  assert.equal(tank(beam.state,'D').alive,false);
  const setupMine=(config={},positions)=>({...setup(config,positions),mines:[{id:'mine',owner:'A',x:105,y:80,armedAt:1,ownerCleared:true,triggeredAt:null,detonateAt:null}]});
  const off=roundGame.step(setupMine(),{});
  assert.equal(off.state.mines.length,1);
  assert(!off.events.some(e=>e.type==='mine-trigger'));
  const on=roundGame.step(setupMine({friendlyFire:true}),{});
  assert(on.events.some(e=>e.type==='mine-trigger'));
  const foe=roundGame.step(setupMine({},[60,90,120]),{});
  assert(foe.events.some(e=>e.type==='mine-trigger'));
});

test('surviving teammates become invulnerable simultaneously and win after standard settlement',()=>{
  const s=setup({friendlyFire:true});
  const killed=roundGame.step({...s,bullets:[shot('B',121,15)]},{});
  assert.deepEqual(killed.events.find(e=>e.type==='last-team-pending'),
    {type:'last-team-pending',teamId:'1',tankIds:['A','B'],settleUntil:181});
  assert.equal(tank(killed.state,'A').invulnerable,true);
  assert.equal(tank(killed.state,'B').invulnerable,true);
  const win=roundGame.step({...killed.state,tick:180,bullets:[shot('A',80,60),shot('B',43,8)]},{});
  assert(win.state.tanks.filter(t=>t.alive).every(t=>t.invulnerable));
  assert(!win.events.some(e=>e.type==='hit'));
  assert.deepEqual(win.result,{winner:null,winnerTeam:'1',reason:'last-team'});
});

test('zone still eliminates allies and enemies on the same tick before immunity',()=>{
  const s=setup({shrinkAfterSeconds:0,shrinkDurationSeconds:1});
  const r=roundGame.step({...s,tick:60,zone:{...s.zone,outsideTicks:{A:119,B:119,D:119}}},{});
  assert.deepEqual(r.events.filter(e=>e.type==='zone-eliminated').map(e=>e.tankId),players);
  assert(!r.state.tanks.some(t=>t.invulnerable));
  assert.deepEqual(r.result,{winner:null,reason:'mutual-knockout'});
});

test('team round winner is forwarded to series standings, not individual seat score',()=>{
  const s=game.init({seed:1,config:{teams,roundLimit:1},players});
  const r=game.step({...s,tanks:s.tanks.map(t=>({...t,alive:t.id!=='D',invulnerable:t.id!=='D'})),settleUntil:1},{});
  assert.equal(r.state.roundWinnerTeam,'1');
  assert.deepEqual(r.result,{winner:null,winnerTeam:'1',reason:'round-limit',scores:{A:0,B:0,D:0},teamScores:{1:1,4:0}});
});
