import {CLASSIC_DATA,CLASSIC_FRAME_RATE,classicProfile} from './profile.js';
import {traceLaser} from './laser-geometry.js';

const CELL = 64, TANK_RADIUS = 12, BULLET_RADIUS = 3;
const EPS = 1e-7, TAU = 2 * Math.PI;
export const PICKUP_TYPES = Object.freeze(Object.keys(CLASSIC_DATA.crates.weights));
const between = (x, a, b) => Math.max(a, Math.min(b, x));

function next(rng) {
  let x = rng.value;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rng.value = x >>> 0;
  return rng.value / 4294967296;
}

function seedValue(input) {
  if (!['string','number'].includes(typeof input) || (typeof input === 'number' && !Number.isFinite(input))) {
    throw new TypeError('seed must be a string or finite number');
  }
  let hash = 2166136261;
  for (const c of String(input)) {
    hash ^= c.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

const defaults = profile => ({cols:12,rows:9,maxTicks:60*profile.tickRate,pickupInterval:360,
  pickups:true,shellSpeed:profile.shellSpeed,shrinkAfterSeconds:40,shrinkDurationSeconds:15,
  mazeComplexity:'classic',friendlyFire:false,teams:undefined,classicSolo:false});
const LOOP_OPENING_CHANCE=Object.freeze({...CLASSIC_DATA.mazeLoopChance});
const TEAM_IDS=Object.freeze(['1','2','3','4']);
const CRATE_HALF_SIZE=8, PICKUP_PADDING=2;
const ZONE_FINAL_MIN_HALF_SPAN=24;

export function validateTeams(teams,players) {
  if (teams===undefined) return undefined;
  if (!Array.isArray(players)||new Set(players).size!==players.length||
      !teams||typeof teams!=='object'||Array.isArray(teams)||
      Object.keys(teams).length!==players.length||players.some(id=>
        typeof id!=='string'||!/^[A-H]$/.test(id)||!Object.hasOwn(teams,id)||!TEAM_IDS.includes(teams[id]))) {
    throw new TypeError('teams must map every occupied seat A–H to a team ID "1" through "4"');
  }
  if (new Set(players.map(id=>teams[id])).size<2) throw new RangeError('teams must contain at least two teams');
  return Object.fromEntries(players.map(id=>[id,teams[id]]));
}

function normalizedConfig(input={}, profile) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('config must be an object');
  const base=defaults(profile);
  for (const key of Object.keys(input)) if (!Object.hasOwn(base, key)) throw new Error('unknown config key: ' + key);
  const c = {...base,...input};
  for (const [key, lo, hi] of [['cols',4,16],['rows',4,12],['maxTicks',1,36000],['pickupInterval',1,3600],
    ['shrinkAfterSeconds',0,120],['shrinkDurationSeconds',1,120]]) {
    if (!Number.isInteger(c[key]) || c[key] < lo || c[key] > hi) throw new RangeError(key + ' must be an integer in [' + lo + ', ' + hi + ']');
  }
  for (const key of ['pickups','friendlyFire','classicSolo']) {
    if (typeof c[key] !== 'boolean') throw new TypeError(key+' must be a boolean');
  }
  if (Object.hasOwn(input,'shellSpeed') && (!Number.isFinite(c.shellSpeed)||c.shellSpeed<3||c.shellSpeed>9)) {
    throw new RangeError('shellSpeed must be a finite number between 3 and 9 px/tick');
  }
  if (!Object.hasOwn(input,'maxTicks')) {
    c.maxTicks=Math.max(c.maxTicks,(c.shrinkAfterSeconds+c.shrinkDurationSeconds+5)*profile.tickRate);
  }
  if (typeof c.mazeComplexity!=='string'||!Object.hasOwn(LOOP_OPENING_CHANCE,c.mazeComplexity)) {
    throw new RangeError('mazeComplexity must be open, classic or dense');
  }
  if (c.teams===undefined) delete c.teams;
  if (!Object.hasOwn(input,'pickupInterval')) delete c.pickupInterval;
  return c;
}

function generateMaze(cols, rows, rng, loopChance) {
  const walls = [];
  const internal = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
    if (x < cols) {
      const line = { x1: x * CELL, y1: y * CELL, x2: (x+1) * CELL, y2: y * CELL };
      if (y === 0 || y === rows) walls.push(line);
      else internal.push({ line, a: (y-1)*cols+x, b: y*cols+x });
    }
    if (y < rows) {
      const line = { x1: x * CELL, y1: y * CELL, x2: x * CELL, y2: (y+1) * CELL };
      if (x === 0 || x === cols) walls.push(line);
      else internal.push({ line, a: y*cols+x-1, b: y*cols+x });
    }
  }
  for (let i = internal.length-1; i > 0; i--) {
    const j = Math.floor(next(rng) * (i+1));
    [internal[i], internal[j]] = [internal[j], internal[i]];
  }
  // Randomized Kruskal: guarantee a path between every pair of cells.
  const parent = Array.from({ length: cols*rows }, (_, i) => i);
  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  for (const e of internal) {
    const a = find(e.a), b = find(e.b);
    if (a !== b) parent[a] = b;
    else if (next(rng) >= loopChance) walls.push(e.line);
  }
  return walls;
}

// Select distinct cell centers by maximizing the nearest distance to the
// already occupied centers. Shuffling first gives stable seed-resolved ties.
function multiplayerSpawns(cols, rows, walls, count, rng) {
  const candidates=Array.from({length:cols*rows},(_,i)=>({col:i%cols,row:Math.floor(i/cols)}));
  for(let i=candidates.length-1;i>0;i--) {
    const j=Math.floor(next(rng)*(i+1));
    [candidates[i],candidates[j]]=[candidates[j],candidates[i]];
  }
  const selected=[];
  while (selected.length<count) {
    let bestIndex=0,bestDistance=-1;
    for (let i=0;i<candidates.length;i++) {
      const c=candidates[i];
      const nearest=selected.reduce((d,p)=>Math.min(d,(p.col-c.col)**2+(p.row-c.row)**2),Infinity);
      if (nearest>bestDistance) {bestDistance=nearest;bestIndex=i;}
    }
    selected.push(candidates.splice(bestIndex,1)[0]);
  }
  const wallIndex=new Set(walls.map(w=>[w.x1,w.y1,w.x2,w.y2].join(',')));
  return selected.map(({col,row})=>{
    const x=col*CELL,y=row*CELL;
    const open=[
      [0,[x+CELL,y,x+CELL,y+CELL]],
      [Math.PI/2,[x,y+CELL,x+CELL,y+CELL]],
      [Math.PI,[x,y,x,y+CELL]],
      [3*Math.PI/2,[x,y,x+CELL,y]]
    ].filter(([,edge])=>!wallIndex.has(edge.join(',')));
    // The maze is connected, so every cell has at least one opening.
    return {x:x+CELL/2,y:y+CELL/2,angle:open[Math.floor(next(rng)*open.length)][0]};
  });
}

function initRound({ seed, config, players }, profile) {
  if (!Array.isArray(players) || players.length<2 || players.length>8 || new Set(players).size !== players.length ||
      [...players].some(x => typeof x !== 'string' || !x.trim() || x.length > 128)) {
    throw new TypeError('two to eight distinct nonempty string player IDs are required');
  }
  const c = normalizedConfig(config,profile), rng = { value: seedValue(seed) };
  if (c.teams!==undefined) c.teams=validateTeams(c.teams,players);
  const width = c.cols * CELL, height = c.rows * CELL;
  const walls = generateMaze(c.cols, c.rows, rng, LOOP_OPENING_CHANCE[c.mazeComplexity]);
  let spawns = [
    { x: CELL/2, y: CELL/2, angle: 0 },
    { x: width-CELL/2, y: height-CELL/2, angle: Math.PI }
  ];
  if (players.length>3) spawns=multiplayerSpawns(c.cols,c.rows,walls,players.length,rng);
  else if (next(rng) < 0.5) spawns.reverse();
  if (players.length === 3) {
    spawns.push({ x:width-CELL/2,y:CELL/2,angle:Math.PI },{ x:CELL/2,y:height-CELL/2,angle:0 });
    for (let i=spawns.length-1;i>0;i--) {
      const j=Math.floor(next(rng)*(i+1));
      [spawns[i],spawns[j]]=[spawns[j],spawns[i]];
    }
  }
  return {
    tick: 0, width, height, walls, config: c, rng: rng.value, nextBullet: 1, nextPickup: 1,nextMine:1,
    tanks: players.map((id,i) => ({ id, ...spawns[i], alive: true, cooldown: 0, weapon:null,
      weaponAmmo:0, weaponCharge:0, weaponGap:0, fragId:null, fireHeld:false, aimAngle:null, aimGuide:null })),
    bullets: [], pickups: [], mines:[], settleUntil:null, result: null,
    pickupBlocks:[],shellLimit:profile.shellLimit
  };
}

function initWithZone(input,profile) {
  const state=initRound(input,profile);
  const tickRate=profile.tickRate;
  const {width,height}=state;
  // The middle cell is reachable; for even dimensions choose the upper/left
  // tied cell so the center never lies on a maze wall.
  const x=(Math.floor((state.config.cols-1)/2)+0.5)*CELL;
  const y=(Math.floor((state.config.rows-1)/2)+0.5)*CELL;
  const initialScale=Math.max(Math.max(x,width-x)/width,Math.max(y,height-y)/height);
  const finalScale=ZONE_FINAL_MIN_HALF_SPAN/Math.min(width,height);
  const initialHalfWidth=width*initialScale, initialHalfHeight=height*initialScale;
  const startTick=state.config.shrinkAfterSeconds*tickRate;
  const zone={x,y,halfWidth:initialHalfWidth,halfHeight:initialHalfHeight,initialHalfWidth,initialHalfHeight,
    finalHalfWidth:width*finalScale,finalHalfHeight:height*finalScale,
    startTick,endTick:startTick+state.config.shrinkDurationSeconds*tickRate,graceTicks:profile.zoneGraceTicks,
    outsideTicks:Object.fromEntries(state.tanks.map(t=>[t.id,0]))};
  return {...state,zone,tanks:state.tanks.map(t=>({...t,invulnerable:false}))};
}

export function roundTickLimit(config, tickRate) {
  const profile=classicProfile(tickRate);
  return normalizedConfig(config,profile).maxTicks;
}
export function matchTickLimit({scoreToWin:_scoreToWin,roundLimit:_roundLimit,...config}={}, tickRate) {
  return Math.min(100_000,Math.max(140*tickRate,3*(roundTickLimit(config,tickRate)+tickRate)));
}
export function init(input,tickRate) {
  const base=classicProfile(tickRate);
  const state=initWithZone(input,base);
  const crate=CLASSIC_DATA.roster[state.tanks.length].pickups;
  const profile={...base,crateLimit:crate.maxOnField,crateMinSeconds:crate.minSeconds,crateMaxSeconds:crate.maxSeconds};
  const {teams,friendlyFire,shellSpeed}=state.config;
  const rng={value:state.rng};
  const nextPickupAt=state.config.pickups?classicPickupDelay({...state,profile},rng):null;
  return {...state,friendlyFire,...(teams?{teams:{...teams}}:{}),
    profile:Object.freeze({...profile,shellSpeed}),rng:rng.value,nextPickupAt};
}

function distanceToWallSquared(x, y, w) {
  return (x-between(x,w.x1,w.x2))**2 + (y-between(y,w.y1,w.y2))**2;
}

function circleHit(x, y, dx, dy, cx, cy, r) {
  const ox = x-cx, oy = y-cy;
  const a = dx*dx+dy*dy, b = ox*dx+oy*dy, c = ox*ox+oy*oy-r*r;
  if (a <= EPS || b >= -EPS) return null;
  if (c <= EPS) return 0;
  const disc = b*b-a*c;
  if (disc <= 0) return null;
  const t = (-b-Math.sqrt(disc))/a;
  return t >= -EPS && t <= 1+EPS ? between(t,0,1) : null;
}

// Swept circular shell against each zero-thickness segment expanded by its radius.
function wallHit(x,y,dx,dy,walls,radius=BULLET_RADIUS) {
  let best = null;
  function consider(t,nx,ny) {
    if (t < (radius===0?0:-EPS) || t > 1+EPS || dx*nx+dy*ny >= -EPS) return;
    t = between(t,0,1);
    if (!best || t < best.t-EPS) best = { t, normals: [{nx,ny}] };
    else if (Math.abs(t-best.t) <= EPS && !best.normals.some(n => Math.abs(n.nx-nx)+Math.abs(n.ny-ny)<EPS)) {
      best.normals.push({nx,ny});
    }
  }
  for (const w of walls) {
    if (w.x1 === w.x2 && Math.abs(dx) > EPS) {
      const nx = -Math.sign(dx), t = (w.x1+nx*radius-x)/dx;
      const yy = y+t*dy;
      if (yy >= w.y1-EPS && yy <= w.y2+EPS) consider(t,nx,0);
    }
    if (w.y1 === w.y2 && Math.abs(dy) > EPS) {
      const ny = -Math.sign(dy), t = (w.y1+ny*radius-y)/dy;
      const xx = x+t*dx;
      if (xx >= w.x1-EPS && xx <= w.x2+EPS) consider(t,0,ny);
    }
    if (radius===0) continue;
    for (const [cx,cy] of [[w.x1,w.y1],[w.x2,w.y2]]) {
      const t = circleHit(x,y,dx,dy,cx,cy,radius);
      if (t !== null) {
        const nx = x+t*dx-cx, ny = y+t*dy-cy, len = Math.hypot(nx,ny);
        if (len > EPS) consider(t,nx/len,ny/len);
      }
    }
  }
  return best;
}

function muzzle(s,t,radius=0) {
  const dx=Math.cos(t.angle)*s.profile.muzzleOffset,dy=Math.sin(t.angle)*s.profile.muzzleOffset;
  const crossing=wallHit(t.x,t.y,dx,dy,s.walls,radius);
  const length=crossing?Math.max(0,crossing.t-EPS):1;
  return {x:t.x+dx*length,y:t.y+dy*length};
}

function bounceAxes(b,normals) {
  if(normals.some(n=>Math.abs(n.nx)>EPS)) b.vx=-b.vx;
  if(normals.some(n=>Math.abs(n.ny)>EPS)) b.vy=-b.vy;
}

function bounceVelocity(b, normals) {
  // Combine tied perpendicular hits, e.g. an exact inner corner.
  if (normals.some(a => normals.some(c => Math.abs(a.nx*c.ny-a.ny*c.nx)>EPS))) {
    b.vx = -b.vx; b.vy = -b.vy;
    return;
  }
  const { nx, ny } = normals[0], dot = b.vx*nx+b.vy*ny;
  b.vx -= 2*dot*nx; b.vy -= 2*dot*ny;
}

const vulnerable=(s,t,ownerId)=>t.alive && !t.invulnerable &&
  (!s.teams||s.friendlyFire||ownerId===t.id||s.teams[t.id]!==s.teams[ownerId]);

function moveTanks(s, actions, events) {
  const proposed = s.tanks.map(t => {
    if (!t.alive) return { ...t };
    const a = Object.hasOwn(actions,t.id) ? actions[t.id] : { throttle: 0, turn: 0, fire: false };
    const locked=t.weapon==='remote'&&t.fragId!=null ||
      t.weapon==='death-ray'&&(t.weaponCharge>0&&t.beamUntil===undefined||t.beamUntil>s.tick);
    const turnRate=s.profile.turnSpeed;
    const moveRate=a.throttle<0?s.profile.reverseSpeed:s.profile.forwardSpeed;
    const angle = ((t.angle+(locked?0:a.turn*turnRate))%TAU+TAU)%TAU;
    const x = t.x+Math.cos(angle)*(locked?0:a.throttle*moveRate), y = t.y+Math.sin(angle)*(locked?0:a.throttle*moveRate);
    const blocked = s.walls.some(w => distanceToWallSquared(x,y,w) < TANK_RADIUS**2);
    if (blocked) events.push({ type:'wall-stop', tankId:t.id, x:t.x, y:t.y });
    return { ...t, x:blocked?t.x:x, y:blocked?t.y:y, angle, cooldown:Math.max(0,t.cooldown-1) };
  });
  // Rewind every conflicting move, repeating if a rewind creates a new conflict.
  const stopped=new Set();
  for (;;) {
    const simultaneous=new Set();
    let changed=false;
    const rewind=k=>{
      proposed[k].x=s.tanks[k].x; proposed[k].y=s.tanks[k].y;
      stopped.add(k); changed=true;
    };
    for (let i=0;i<proposed.length;i++) for (let j=i+1;j<proposed.length;j++) {
      const a=proposed[i],b=proposed[j];
      if (!a.alive || !b.alive || Math.hypot(a.x-b.x,a.y-b.y)>=2*TANK_RADIUS) continue;
      for (const k of [i,j]) if (!stopped.has(k)) {
        // With four or more tanks, resolve all conflicts against one pose
        // snapshot rather than in iteration/seat order.
        if (s.tanks.length>3) simultaneous.add(k);
        else rewind(k);
      }
    }
    for (const k of simultaneous) rewind(k);
    if (!changed) break;
  }
  if (stopped.size) events.push({type:'tank-stop',tankIds:[...stopped].sort((a,b)=>a-b).map(i=>proposed[i].id)});
  s.tanks = proposed;
}

function shell(s, events, { owner, x, y, angle, speed, ttl, kind, sourceId=null, ownerArmed=kind==='shrapnel', safeTicks=0 }) {
  const b={id:'b'+s.nextBullet++,owner,x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,ttl,
    kind,sourceId,ownerArmed};
  if(safeTicks>0) b.safeTicks=safeTicks;
  s.bullets.push(b);
  events.push({type:'shot',bulletId:b.id,tankId:owner,x,y,vx:b.vx,vy:b.vy,kind,sourceId});
  return b;
}

function resetWeapon(t) {
  t.weapon=null;t.weaponAmmo=0;t.weaponCharge=0;t.weaponGap=0;t.fragId=null;t.aimAngle=null;t.aimGuide=null;
}

function resetClassicWeapon(t) {
  resetWeapon(t);
  delete t.burstTick;
  delete t.spinDownUntil;
  delete t.beamUntil;
  delete t.beamId;
}

function burst(b,s,events,type, angle, deferred) {
  const count=s.profile.fragmentCount;
  events.push({type,x:b.x,y:b.y,ownerId:b.owner,[type==='mine-burst'?'mineId':'bulletId']:b.id});
  // Queue bursts after the projectile loop: child objects first advance on
  // the next tick. They get their own stable IDs and explicit source ID.
  for (let i=0;i<count;i++) {
    const heading=angle+i*TAU/count;
    const x=b.x,y=b.y;
    deferred.push({owner:b.owner,x,y,angle:heading,speed:s.profile.fragmentSpeed,ttl:s.profile.fragmentTtl,kind:'shrapnel',sourceId:b.id});
  }
}

function projectileByOwner(s,t) { return s.bullets.find(b=>b.id===t.fragId); }

function guideClassicMissiles(s,actions) {
  const p=s.profile;
  for (const b of s.bullets) {
    if (b.kind!=='missile'&&b.kind!=='remote') continue;
    const old=Math.atan2(b.vy,b.vx);
    let delta=0;
    if (b.kind==='remote') {
      const owner=s.tanks.find(t=>t.id===b.owner);
      const turn=Object.hasOwn(actions,b.owner)?actions[b.owner].turn:0;
      if (owner?.alive&&owner.fragId===b.id) delta=turn*p.remoteTurn;
    } else if ((b.age??0)>=p.missileDelay) {
      let target=null,nearest=Infinity;
      for (const t of s.tanks) if (t.id!==b.owner&&vulnerable(s,t,b.owner)) {
        const d=(t.x-b.x)**2+(t.y-b.y)**2;
        if(d<nearest) {nearest=d;target=t;}
      }
      b.targetId=target?.id??null;
      if(target) {
        const to=Math.atan2(target.y-b.y,target.x-b.x);
        delta=between(Math.atan2(Math.sin(to-old),Math.cos(to-old)),-p.missileTurn,p.missileTurn);
      }
    }
    if(delta!==0) {b.vx=Math.cos(old+delta)*p.missileSpeed;b.vy=Math.sin(old+delta)*p.missileSpeed;}
  }
}

function emitClassicBeam(t,s,events,impacts,firingTick) {
  const dx=Math.cos(t.aimAngle),dy=Math.sin(t.aimAngle);
  // Stop at the outside perimeter, not at interior walls. This reconstruction
  // keeps the beam straight; it does not reproduce original bending.
  const length=Math.min(dx>EPS?(s.width-t.x)/dx:dx<-EPS?-t.x/dx:Infinity,
    dy>EPS?(s.height-t.y)/dy:dy<-EPS?-t.y/dy:Infinity);
  const endX=t.x+dx*length,endY=t.y+dy*length;
  const beam={id:t.beamId,owner:t.id,kind:'death-ray'};
  events.push({type:firingTick?'weapon-fired':'death-ray-beam',tankId:t.id,weapon:'death-ray',bulletId:beam.id,
    x:t.x,y:t.y,endX,endY,continuous:true});
  for(const target of s.tanks) {
    if (target.id===t.id||!vulnerable(s,target,t.id)) continue;
    const f=circleHit(t.x,t.y,dx*length,dy*length,target.x,target.y,TANK_RADIUS);
    if (f!==null) impacts.push({bullet:beam,tankId:target.id,x:t.x+dx*length*f,y:t.y+dy*length*f});
  }
}

function fireClassicWeapons(s,actions,events,impacts,deferred) {
  const p=s.profile;
  for (const t of s.tanks) {
    if (!t.alive) continue;
    const firing=Object.hasOwn(actions,t.id)&&actions[t.id].fire;
    const pressed=firing&&!t.fireHeld;
    t.fireHeld=firing;
    if (t.weapon==='death-ray') {
      if (t.beamUntil!==undefined) {
        if (s.tick<t.beamUntil) emitClassicBeam(t,s,events,impacts,false);
        else resetClassicWeapon(t);
        continue;
      }
      if (!t.weaponCharge) {
        if (!pressed) continue;
        t.aimAngle=t.angle;
        events.push({type:'weapon-charge',tankId:t.id,weapon:t.weapon,x:t.x,y:t.y});
      }
      if (++t.weaponCharge+EPS<p.deathRayCharge) continue;
      t.beamId='b'+s.nextBullet++;
      t.beamUntil=s.tick+p.deathRayActive;
      emitClassicBeam(t,s,events,impacts,true);
      continue;
    }
    if (t.weapon==='gatling') {
      const spinDown=()=>{
        t.spinDownUntil=s.tick+p.gatlingSpinDown+t.weaponCharge-1;
        t.weaponAmmo=0;t.weaponGap=0;
        delete t.burstTick;
      };
      if (t.spinDownUntil!==undefined) {
        if (s.tick+EPS>=t.spinDownUntil) resetClassicWeapon(t);
        continue;
      }
      if(!firing) {
        if (t.burstTick!==undefined) spinDown();
        continue;
      }
      if (t.burstTick===undefined) {
        if(!pressed) continue;
        t.weaponCharge=1;t.burstTick=s.tick+p.gatlingSpin+p.gatlingGap-p.tickRate/CLASSIC_FRAME_RATE-1;
        events.push({type:'weapon-charge',tankId:t.id,weapon:t.weapon,x:t.x,y:t.y});
      } else t.weaponCharge=Math.min(Math.ceil(p.gatlingSpin),t.weaponCharge+1);
      t.weaponGap=Math.max(0,Math.ceil(t.burstTick-s.tick-EPS));
      if (s.tick+EPS<t.burstTick) continue;
      if (t.weaponAmmo>0) {
        const rng={value:s.rng};
        const spread=(2*next(rng)-1)*p.gatlingSpread;
        shell(s,events,{owner:t.id,...muzzle(s,t,p.gatlingRadius),angle:t.angle+spread,speed:p.gatlingSpeed,
          ttl:p.gatlingTtl,kind:'gatling',ownerArmed:true,safeTicks:p.gatlingSafeTicks});
        s.rng=rng.value;
        t.weaponAmmo--;
      }
      t.burstTick+=p.gatlingGap;
      t.weaponGap=Math.max(0,Math.ceil(t.burstTick-s.tick-EPS));
      continue;
    }
    if (!pressed) continue;
    if (t.weapon==='laser') {
      const b=shell(s,events,{owner:t.id,x:t.x,y:t.y,angle:t.angle,speed:p.laserSpeed,ttl:p.laserTtl,kind:'laser'});
      b.heading=t.angle;b.curved=false;
      events.push({type:'weapon-fired',tankId:t.id,weapon:'laser',bulletId:b.id,x:t.x,y:t.y,
        endX:t.x,endY:t.y,moving:true});
      resetClassicWeapon(t);
      continue;
    }
    if (t.weapon==='mine') {
      const dx=Math.cos(t.angle),dy=Math.sin(t.angle);
      const hit=wallHit(t.x,t.y,-dx*16,-dy*16,s.walls);
      const dist=hit?Math.max(0,hit.t*16-0.1):16;
      const mine={id:'m'+s.nextMine++,owner:t.id,x:t.x-dx*dist,y:t.y-dy*dist,
        armedAt:s.tick+p.mineArm,ownerCleared:false,triggeredAt:null,detonateAt:null};
      s.mines.push(mine);
      events.push({type:'mine-placed',mineId:mine.id,tankId:t.id,x:mine.x,y:mine.y,armedAt:mine.armedAt});
      if (--t.weaponAmmo===0) resetClassicWeapon(t);
      continue;
    }
    if (t.weapon==='frag'||t.weapon==='remote'||t.weapon==='missile') {
      if (t.fragId===null) {
        const b=shell(s,events,{owner:t.id,x:t.x,y:t.y,angle:t.angle,speed:p.missileSpeed,ttl:p.missileTtl,kind:t.weapon});
        if(t.weapon==='missile') {b.age=0;b.targetId=null;resetClassicWeapon(t);}
        else {t.fragId=b.id;t.weaponAmmo=0;}
      } else if (t.weapon==='frag') {
        const b=projectileByOwner(s,t);
        if (b) {
          s.bullets=s.bullets.filter(other=>other.id!==b.id);
          burst(b,s,events,'frag-burst',Math.atan2(b.vy,b.vx),deferred);
        }
        resetClassicWeapon(t);
      }
      // The remote shell waits for collision/expiry; extra presses do not steer or detonate.
      continue;
    }
    if (s.bullets.filter(b=>b.owner===t.id&&b.kind==='shell').length>=p.shellLimit) {
      events.push({type:'shot-blocked',tankId:t.id,reason:'shell-limit'});
      continue;
    }
    const origin=muzzle(s,t,BULLET_RADIUS);
    // A clipped muzzle may lie inside the tank's own hull. Don't count
    // its launch overlap; the first bounce or clear step arms self-hits.
    const ownerArmed=Math.hypot(origin.x-t.x,origin.y-t.y)>=TANK_RADIUS+BULLET_RADIUS;
    shell(s,events,{owner:t.id,...origin,angle:t.angle,speed:p.shellSpeed,ttl:p.shellTtl,kind:'shell',ownerArmed});
  }
}

function advanceLaser(b,s,events,impacts) {
  if (b.ttl<=0) return false;
  const owner=s.tanks.find(t=>t.id===b.owner);
  const trace=traceLaser(s,b,s.profile.laserSpeed*Math.min(1,b.ttl),(x,y,dx,dy,edge,crossing)=>{
    if (!b.ownerArmed&&Math.hypot(x-owner.x,y-owner.y)>TANK_RADIUS+EPS) b.ownerArmed=true;
    let target=null;
    for (const tank of s.tanks) {
      if (!vulnerable(s,tank,b.owner)||tank.id===b.owner&&!b.ownerArmed) continue;
      const f=(x-tank.x)**2+(y-tank.y)**2<TANK_RADIUS**2-EPS?0:circleHit(x,y,dx,dy,tank.x,tank.y,TANK_RADIUS);
      if (f!==null&&f<=crossing&&(edge>1||f<edge-EPS)&&(!target||f<target.f-EPS)) target={tank,f};
    }
    return target;
  });
  const {x,y,heading,curved,path,target,atBoundary}=trace;
  b.x=x;b.y=y;b.heading=heading;b.curved=curved;
  b.vx=Math.cos(heading)*s.profile.laserSpeed;b.vy=Math.sin(heading)*s.profile.laserSpeed;
  b.path=[...(b.path??[]),...(b.path?path.slice(1):path)].slice(-s.profile.laserTrailPoints);
  events.push({type:'laser-path',bulletId:b.id,ownerId:b.owner,path});
  if (target) {
    impacts.push({bullet:b,tankId:target.tank.id,x,y});
    return false;
  }
  b.ttl--;
  if (atBoundary||b.ttl<=0) {
    events.push({type:'shell-expired',bulletId:b.id,x,y,reason:atBoundary?'boundary':'ttl',kind:b.kind});
    return false;
  }
  return true;
}

function advanceShell(b, s, events, impacts, deferred) {
  if(b.kind==='laser') return advanceLaser(b,s,events,impacts);
  function expire(reason) {
    if (b.kind==='frag') {
      burst(b,s,events,'frag-burst',Math.atan2(b.vy,b.vx),deferred);
      const owner=s.tanks.find(t=>t.id===b.owner);
      if (owner?.fragId===b.id) resetWeapon(owner);
    } else if (b.kind==='remote') {
      const owner=s.tanks.find(t=>t.id===b.owner);
      if (owner?.fragId===b.id) resetClassicWeapon(owner);
    }
    events.push({type:'shell-expired',bulletId:b.id,x:b.x,y:b.y,reason,kind:b.kind});
    return false;
  }
  if (b.ttl <= 0) return false;
  let remaining = Math.min(1,b.ttl);
  const radius=b.kind==='gatling'?s.profile.gatlingRadius:b.kind==='shrapnel'?s.profile.fragmentRadius:BULLET_RADIUS;
  // Sweep through the remaining fraction after each bounce; hard cap guarantees
  // bounded work in degenerate geometry.
  for (let i=0;i<8 && remaining>EPS;i++) {
    const dx=b.vx*remaining, dy=b.vy*remaining;
    const wall=wallHit(b.x,b.y,dx,dy,s.walls,radius);
    let target = null;
    for (const t of s.tanks) {
      if (b.safeTicks>EPS || !vulnerable(s,t,b.owner) || (t.id===b.owner && !b.ownerArmed)) continue;
      const targetRadius=TANK_RADIUS+radius;
      const overlapping=(b.x-t.x)**2+(b.y-t.y)**2<targetRadius**2-EPS;
      const f=overlapping?0:circleHit(b.x,b.y,dx,dy,t.x,t.y,targetRadius);
      if (f!==null && (!target || f<target.f-EPS)) target={t,f};
    }
    if (target && (!wall || target.f < wall.t-EPS)) {
      b.x+=dx*target.f; b.y+=dy*target.f;
      impacts.push({bullet:b,tankId:target.t.id,x:b.x,y:b.y});
      return b.kind==='frag'||b.kind==='remote'?expire('impact'):false;
    }
    if (!wall) {
      b.x+=dx; b.y+=dy;
      const owner=s.tanks.find(t=>t.id===b.owner);
      if (Math.hypot(b.x-owner.x,b.y-owner.y)>TANK_RADIUS+radius+EPS) b.ownerArmed=true;
      break;
    }
    b.x+=dx*wall.t; b.y+=dy*wall.t;
    if(b.kind==='shrapnel') return expire('wall');
    if(b.kind==='shell'||b.kind==='gatling') bounceAxes(b,wall.normals);
    else bounceVelocity(b,wall.normals);
    b.ownerArmed=true;
    events.push({type:'bounce',bulletId:b.id,x:b.x,y:b.y,vx:b.vx,vy:b.vy});
    b.x+=b.vx*EPS; b.y+=b.vy*EPS;
    remaining*=1-wall.t;
    if (i===7 && remaining>EPS) {
      return expire('bounce-limit');
    }
  }
  if(b.safeTicks!==undefined) {
    b.safeTicks--;
    if(b.safeTicks<=EPS) delete b.safeTicks;
  }
  if(b.kind==='missile') b.age++;
  b.ttl--;
  return b.ttl>0 || expire('ttl');
}

function classicPickupDelay(s,rng) {
  if (s.config.pickupInterval!==undefined) return s.config.pickupInterval;
  const {crateMinSeconds,crateMaxSeconds,tickRate}=s.profile;
  const min=crateMinSeconds*CLASSIC_FRAME_RATE;
  const frames=min+Math.floor(next(rng)*((crateMaxSeconds-crateMinSeconds)*CLASSIC_FRAME_RATE+1));
  return Math.ceil(frames*tickRate/CLASSIC_FRAME_RATE);
}

function chooseClassicCrate(rng) {
  const pool=Object.entries(CLASSIC_DATA.crates.weights).filter(([,weight])=>weight>0);
  let roll=next(rng)*pool.reduce((sum,[,weight])=>sum+weight,0);
  for (const [id,weight] of pool) {
    if (roll<weight) return id;
    roll-=weight;
  }
  return pool.at(-1)?.[0];
}

function samplePickup(s,rng) {
  const spots=[];
  for (let y=CELL/2;y<s.height;y+=CELL) for (let x=CELL/2;x<s.width;x+=CELL) {
    if (s.pickups.some(p=>p.x===x&&p.y===y) || s.tanks.some(t=>t.alive&&Math.hypot(t.x-x,t.y-y)<30)) continue;
    spots.push({x,y});
  }
  if (!spots.length) return null;
  const spot=spots[Math.floor(next(rng)*spots.length)];
  const type=s.config.classicSolo?CLASSIC_DATA.crates.soloType:chooseClassicCrate(rng);
  return {...spot,type};
}

// An informational hint: does not consume RNG or reserve a spot. Any intervening
// random draw or change to viable cells may shift the candidate before spawn.
export function pickupForecast(s) {
  if (!s.config.pickups || s.phase!=='playing' || s.settleUntil!==null || !Number.isInteger(s.nextPickupAt)) return undefined;
  const ticksUntil=Math.max(0,s.nextPickupAt-s.roundTick);
  const candidate=ticksUntil<=2*s.profile.tickRate&&s.pickups.length<s.profile.crateLimit
    ?samplePickup(s,{value:s.rng}):null;
  return {attemptTick:s.nextPickupAt,ticksUntil,...(candidate?{candidate}:{})};
}

function awardPickups(s, events, spawn=true) {
  if (!s.config.pickups) return;
  const rng = {value:s.rng};
  const attempt=spawn&&s.tick>=s.nextPickupAt;
  if (attempt && s.pickups.length < s.profile.crateLimit) {
    const candidate=samplePickup(s,rng);
    if (candidate) {
      const p={id:'p'+s.nextPickup++,...candidate};
      s.pickups.push(p);
      events.push({type:'pickup-spawn',pickupType:p.type,pickupId:p.id,x:p.x,y:p.y});
    }
  }
  // An attempt at the cap or without a legal position still resets the timer.
  if (attempt) s.nextPickupAt=s.tick+classicPickupDelay(s,rng);
  const blocked=[];
  const blockedPreviously=s.pickupBlocks;
  s.pickups=s.pickups.filter(p=>{
    const contact=(t)=>{
      const dx=Math.max(Math.abs(t.x-p.x)-CRATE_HALF_SIZE,0),dy=Math.max(Math.abs(t.y-p.y)-CRATE_HALF_SIZE,0);
      return dx*dx+dy*dy <= (TANK_RADIUS+PICKUP_PADDING)**2;
    };
    const touched=s.tanks.filter(t=>t.alive&&contact(t));
    const candidates=touched.filter(t=>!t.weapon);
    if (!candidates.length) {
      for (const t of touched) {
        blocked.push({tankId:t.id,pickupId:p.id});
        if (!blockedPreviously?.some(b=>b.tankId===t.id&&b.pickupId===p.id)) {
          events.push({type:'pickup-blocked',tankId:t.id,pickupId:p.id,pickupType:p.type,
            heldWeapon:t.weapon,reason:'weapon-slot-occupied',x:p.x,y:p.y});
        }
      }
      return true;
    }
    const distances=candidates.map(t=>Math.hypot(t.x-p.x,t.y-p.y));
    const minimum=Math.min(...distances);
    const tied=candidates.filter((_t,i)=>Math.abs(distances[i]-minimum)<=EPS);
    const winner=tied.length===1?tied[0]:tied[Math.floor(next(rng)*tied.length)];
    winner.weapon=p.type;
    winner.weaponAmmo=p.type==='gatling'?s.profile.gatlingAmmo:p.type==='mine'?s.profile.mineAmmo:1;
    const requiresPress=p.type!=='gatling';
    events.push({type:'pickup',tankId:winner.id,pickupId:p.id,pickupType:p.type,x:p.x,y:p.y,
      weaponAmmo:winner.weaponAmmo,activation:requiresPress?'press':'hold',releaseRequired:requiresPress&&winner.fireHeld});

    return false;
  });
  s.rng=rng.value;
  s.pickupBlocks=blocked;
}

function advanceClassicMines(s,events,deferred) {
  s.mines=s.mines.filter(m=>{
    const owner=s.tanks.find(t=>t.id===m.owner);
    if (!owner.alive||Math.hypot(owner.x-m.x,owner.y-m.y)>TANK_RADIUS+8) m.ownerCleared=true;
    if (m.detonateAt!==null) {
      if (s.tick+EPS<m.detonateAt) return true;
      burst(m,s,events,'mine-burst',0,deferred);
      return false;
    }
    if (s.tick+EPS<m.armedAt) return true;
    const victim=s.tanks.find(t=>vulnerable(s,t,m.owner)&&(t.id!==m.owner||m.ownerCleared)&&Math.hypot(t.x-m.x,t.y-m.y)<=TANK_RADIUS+6);
    if (victim) {
      m.triggeredAt=s.tick;
      m.detonateAt=s.tick+s.profile.mineFuse;
      events.push({type:'mine-trigger',mineId:m.id,tankId:victim.id,x:m.x,y:m.y,detonateAt:m.detonateAt});
    }
    return true;
  });
}

function advanceZone(s, events) {
  const zone=s.zone;
  if (s.tick<zone.startTick) return;
  const fraction=between((s.tick-zone.startTick)/(zone.endTick-zone.startTick),0,1);
  const lerp=(a,b)=>fraction===1?b:a+(b-a)*fraction;
  const halfWidth=lerp(zone.initialHalfWidth,zone.finalHalfWidth);
  const halfHeight=lerp(zone.initialHalfHeight,zone.finalHalfHeight);
  const outsideTicks={...zone.outsideTicks};
  for (const tank of s.tanks) {
    if (!tank.alive) continue;
    const outside=!tank.invulnerable && (Math.abs(tank.x-zone.x)>halfWidth || Math.abs(tank.y-zone.y)>halfHeight);
    const exposure=outside?outsideTicks[tank.id]+1:0;
    outsideTicks[tank.id]=exposure;
    if (exposure>=zone.graceTicks) {
      tank.alive=false;
      events.push({type:'zone-eliminated',tankId:tank.id,x:tank.x,y:tank.y});
    }
  }
  s.zone={...zone,halfWidth,halfHeight,outsideTicks};
}

export function step(state, actions) {
  if (state.result) return {state,events:[],result:state.result};
  const s={...state,tick:state.tick+1,bullets:state.bullets.map(b=>({...b})),pickups:[...state.pickups],
    mines:state.mines.map(m=>({...m}))};
  const events=[], impacts=[], deferred=[];
  moveTanks(s,actions,events);
  guideClassicMissiles(s,actions);
  fireClassicWeapons(s,actions,events,impacts,deferred);
  s.bullets=s.bullets.filter(b=>advanceShell(b,s,events,impacts,deferred));
  advanceClassicMines(s,events,deferred);
  for (const sp of deferred) shell(s,events,sp);
  // All impacts are collected against the same pre-damage tank poses.
  for (const impact of impacts) {
    const t=s.tanks.find(t=>t.id===impact.tankId), b=impact.bullet;
    events.push({type:'hit',bulletId:b.id,tankId:t.id,ownerId:b.owner,x:impact.x,y:impact.y,kind:b.kind});
    if (t.alive) {
      t.alive=false;
      events.push({type:'destroyed',tankId:t.id,bulletId:b.id,ownerId:b.owner,kind:b.kind});
    }
  }
  advanceZone(s,events);
  const alive=s.tanks.filter(t=>t.alive);
  const survivorTeam=alive.length && s.teams && alive.every(t=>s.teams[t.id]===s.teams[alive[0].id])
    ?s.teams[alive[0].id]:null;
  if (alive.length===0) s.result={winner:null,reason:s.tanks.length===2?'double-knockout':'mutual-knockout'};
  else if (alive.length===1 || survivorTeam!==null) {
    for(const survivor of alive) survivor.invulnerable=true;
    const exposed=alive.filter(t=>s.zone.outsideTicks[t.id]!==0);
    if (exposed.length) {
      s.zone={...s.zone,outsideTicks:{...s.zone.outsideTicks,...Object.fromEntries(exposed.map(t=>[t.id,0]))}};
    }
    if (s.settleUntil===null) {
      s.settleUntil=s.tick+s.profile.settleTicks;
      events.push(survivorTeam!==null
        ?{type:'last-team-pending',teamId:survivorTeam,tankIds:alive.map(t=>t.id),settleUntil:s.settleUntil}
        :{type:'last-tank-pending',tankId:alive[0].id,settleUntil:s.settleUntil});
    }
    if (s.tick>=s.settleUntil) s.result=survivorTeam!==null
      ?{winner:null,winnerTeam:survivorTeam,reason:'last-team'}
      :{winner:alive[0].id,reason:'last-tank'};
    else awardPickups(s,events,false);
  } else {
    awardPickups(s,events);
    if (s.tick>=s.config.maxTicks) s.result={winner:null,reason:'timeout'};
  }
  // The guide previews the same curved trajectory without target collisions.
  for (const t of s.tanks) t.aimGuide=t.alive&&t.weapon==='laser'
    ? Object.freeze(traceLaser(s,{x:t.x,y:t.y,heading:t.angle},s.profile.laserGuide).path.map(p=>Object.freeze(p))) : null;
  if (s.result) {
    s.pickupBlocks=[];
    events.push({type:'ended',...s.result});
  }
  return {state:s,events,result:s.result};
}
