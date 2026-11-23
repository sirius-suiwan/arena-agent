export const TICK_RATE = 60;
const CELL = 64, TANK_RADIUS = 12, BULLET_RADIUS = 3;
const MOVE = 2.2, TURN = 0.06, SHELL_SPEED = 6, LIFETIME = 450, COOLDOWN = 24;
const EPS = 1e-7, TAU = 2 * Math.PI;
export const PICKUP_TYPES = Object.freeze(['death-ray', 'gatling', 'mine', 'frag', 'laser']);
const SETTLE = 180, MINE_ARM = 30, FRAG_TTL = 240, SHRAPNEL_TTL=60;
const LASER_RANGE=576, LASER_GUIDE=256;
const DEATH_CHARGE=90, GATLING_AMMO=18, GATLING_CHARGE=18, GATLING_GAP=5;
const MAX_SHELLS = 5;
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

export const DEFAULT_CONFIG = Object.freeze({ cols: 8, rows: 6, maxTicks: 3600, pickupInterval: 360, pickups: true });

function normalizedConfig(input) {
  if (input === undefined) return { ...DEFAULT_CONFIG };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('config must be an object');
  for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULT_CONFIG, key)) throw new Error('unknown config key: ' + key);
  const c = { ...DEFAULT_CONFIG, ...input };
  for (const [key, lo, hi] of [['cols',4,16],['rows',4,12],['maxTicks',1,36000],['pickupInterval',1,3600]]) {
    if (!Number.isInteger(c[key]) || c[key] < lo || c[key] > hi) throw new RangeError(key + ' must be an integer in [' + lo + ', ' + hi + ']');
  }
  if (typeof c.pickups !== 'boolean') throw new TypeError('pickups must be a boolean');
  return c;
}

function generateMaze(cols, rows, rng) {
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
    else if (next(rng) >= 0.22) walls.push(e.line);
  }
  return walls;
}

export function init({ seed, config, players }) {
  if (!Array.isArray(players) || ![2,3].includes(players.length) || new Set(players).size !== players.length ||
      players.some(x => typeof x !== 'string' || !x.trim() || x.length > 128)) {
    throw new TypeError('two or three distinct nonempty string player IDs are required');
  }
  const c = normalizedConfig(config), rng = { value: seedValue(seed) };
  const width = c.cols * CELL, height = c.rows * CELL;
  const walls = generateMaze(c.cols, c.rows, rng);
  const spawns = [
    { x: CELL/2, y: CELL/2, angle: 0 },
    { x: width-CELL/2, y: height-CELL/2, angle: Math.PI }
  ];
  if (next(rng) < 0.5) spawns.reverse();
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
    bullets: [], pickups: [], mines:[], settleUntil:null, result: null
  };
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

function bounceVelocity(b, normals) {
  // Combine tied perpendicular hits, e.g. an exact inner corner.
  if (normals.some(a => normals.some(c => Math.abs(a.nx*c.ny-a.ny*c.nx)>EPS))) {
    b.vx = -b.vx; b.vy = -b.vy;
    return;
  }
  const { nx, ny } = normals[0], dot = b.vx*nx+b.vy*ny;
  b.vx -= 2*dot*nx; b.vy -= 2*dot*ny;
}

// Ray path is a point sweep against wall segments, sharing the same corner
// priority as shells. It can encounter its owner after the first reflection.
function traceLaser(s,tank,range,withTanks) {
  let {x,y}=tank;
  const dir={vx:Math.cos(tank.angle),vy:Math.sin(tank.angle)};
  const path=[{x,y}];
  for (let segment=0;segment<16 && range>EPS;segment++) {
    const dx=dir.vx*range,dy=dir.vy*range;
    const wall=wallHit(x,y,dx,dy,s.walls,0);
    let target=null;
    if (withTanks) for (const t of s.tanks) {
      if (!t.alive || (segment===0&&t.id===tank.id)) continue;
      const f=circleHit(x,y,dx,dy,t.x,t.y,TANK_RADIUS);
      if (f!==null && (!target||f<target.f-EPS)) target={id:t.id,f};
    }
    if (target&&(!wall||target.f<wall.t-EPS)) {
      const end={x:x+dx*target.f,y:y+dy*target.f};
      return {path:[...path,end],targetId:target.id};
    }
    if (!wall) return {path:[...path,{x:x+dx,y:y+dy}],targetId:null};
    x+=dx*wall.t;y+=dy*wall.t;
    path.push({x,y});
    bounceVelocity(dir,wall.normals);
    x+=dir.vx*EPS*4;y+=dir.vy*EPS*4;
    range*=1-wall.t;
  }
  return {path,targetId:null};
}

function moveTanks(s, actions, events) {
  const proposed = s.tanks.map(t => {
    if (!t.alive) return { ...t };
    const a = Object.hasOwn(actions,t.id) ? actions[t.id] : { throttle: 0, turn: 0, fire: false };
    const locked=t.weapon==='death-ray'&&t.weaponCharge>0&&a.fire;
    const angle = ((t.angle+(locked?0:a.turn*TURN))%TAU+TAU)%TAU;
    const x = t.x+Math.cos(angle)*(locked?0:a.throttle*MOVE), y = t.y+Math.sin(angle)*(locked?0:a.throttle*MOVE);
    const blocked = s.walls.some(w => distanceToWallSquared(x,y,w) < TANK_RADIUS**2);
    if (blocked) events.push({ type:'wall-stop', tankId:t.id, x:t.x, y:t.y });
    return { ...t, x:blocked?t.x:x, y:blocked?t.y:y, angle, cooldown:Math.max(0,t.cooldown-1) };
  });
  // Rewind every conflicting move, repeating if a rewind creates a new conflict.
  const stopped=new Set();
  for (;;) {
    let changed=false;
    for (let i=0;i<proposed.length;i++) for (let j=i+1;j<proposed.length;j++) {
      const a=proposed[i],b=proposed[j];
      if (!a.alive || !b.alive || Math.hypot(a.x-b.x,a.y-b.y)>=2*TANK_RADIUS) continue;
      for (const k of [i,j]) if (!stopped.has(k)) {
        proposed[k].x=s.tanks[k].x; proposed[k].y=s.tanks[k].y;
        stopped.add(k); changed=true;
      }
    }
    if (!changed) break;
  }
  if (stopped.size) events.push({type:'tank-stop',tankIds:[...stopped].sort((a,b)=>a-b).map(i=>proposed[i].id)});
  s.tanks = proposed;
}

function shell(s, events, { owner, x, y, angle, speed, ttl, kind, sourceId=null }) {
  const b={id:'b'+s.nextBullet++,owner,x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,ttl,
    kind,sourceId,ownerArmed:kind==='shrapnel'};
  s.bullets.push(b);
  events.push({type:'shot',bulletId:b.id,tankId:owner,x,y,vx:b.vx,vy:b.vy,kind,sourceId});
  return b;
}

function resetWeapon(t) {
  t.weapon=null;t.weaponAmmo=0;t.weaponCharge=0;t.weaponGap=0;t.fragId=null;t.aimAngle=null;t.aimGuide=null;
}

function burst(b,s,events,type, angle, deferred) {
  const count=type==='mine-burst'?12:16;
  events.push({type,x:b.x,y:b.y,ownerId:b.owner,[type==='mine-burst'?'mineId':'bulletId']:b.id});
  // Queue bursts after the projectile loop: child objects first advance on
  // the next tick. They get their own stable IDs and explicit source ID.
  for (let i=0;i<count;i++) {
    const heading=angle+i*TAU/count;
    const x=b.x,y=b.y;
    deferred.push({owner:b.owner,x,y,angle:heading,speed:5,ttl:SHRAPNEL_TTL,kind:'shrapnel',sourceId:b.id});
  }
}

function fireShells(s, actions, events, impacts, deferred) {
  for (const t of s.tanks) {
    if (!t.alive) continue;
    const firing=Object.hasOwn(actions,t.id)&&actions[t.id].fire;
    const pressed=firing&&!t.fireHeld;
    t.fireHeld=firing;
    if (t.weaponGap>0) t.weaponGap--;
    if (!firing) {
      if (t.weapon==='death-ray') {t.weaponCharge=0;t.aimAngle=null;}
      continue;
    }
    if (t.weapon==='laser') {
      if (!pressed) continue;
      const {path,targetId}=traceLaser(s,t,LASER_RANGE,true);
      const b={id:'b'+s.nextBullet++,owner:t.id,kind:'laser'};
      const end=path.at(-1);
      events.push({type:'weapon-fired',tankId:t.id,weapon:'laser',bulletId:b.id,x:t.x,y:t.y,
        endX:end.x,endY:end.y,path});
      if (targetId!==null) impacts.push({bullet:b,tankId:targetId,x:end.x,y:end.y});
      resetWeapon(t);
      continue;
    }
    if (t.weapon==='death-ray') {
      if (!t.weaponCharge) {
        t.aimAngle=t.angle;
        events.push({type:'weapon-charge',tankId:t.id,weapon:t.weapon,x:t.x,y:t.y});
      }
      if (++t.weaponCharge<DEATH_CHARGE) continue;
      const dx=Math.cos(t.aimAngle),dy=Math.sin(t.aimAngle);
      const range=Math.hypot(s.width,s.height);
      const endX=t.x+dx*range,endY=t.y+dy*range;
      const b={id:'b'+s.nextBullet++,owner:t.id,kind:'death-ray'};
      events.push({type:'weapon-fired',tankId:t.id,weapon:t.weapon,bulletId:b.id,x:t.x,y:t.y,endX,endY});
      for (const enemy of s.tanks) {
        if (!enemy.alive||enemy.id===t.id) continue;
        const f=circleHit(t.x,t.y,dx*range,dy*range,enemy.x,enemy.y,TANK_RADIUS);
        if (f!==null) impacts.push({bullet:b,tankId:enemy.id,x:t.x+dx*range*f,y:t.y+dy*range*f});
      }
      resetWeapon(t);
      continue;
    }
    if (t.weapon==='gatling') {
      if (t.weaponCharge<GATLING_CHARGE) t.weaponCharge++;
      if (t.weaponCharge<GATLING_CHARGE || t.weaponGap) continue;
      const spread=((t.weaponAmmo%3)-1)*0.045;
      shell(s,events,{owner:t.id,x:t.x,y:t.y,angle:t.angle+spread,speed:7.5,ttl:90,kind:'gatling'});
      t.weaponGap=GATLING_GAP;
      if (--t.weaponAmmo===0) resetWeapon(t);
      continue;
    }
    if (t.weapon==='mine') {
      if (!pressed) continue;
      const dx=Math.cos(t.angle),dy=Math.sin(t.angle);
      // Clamp to the last unobstructed point between the hull and the wall.
      const hit=wallHit(t.x,t.y,-dx*16,-dy*16,s.walls);
      const dist=hit?Math.max(0,hit.t*16-0.1):16;
      const mine={id:'m'+s.nextMine++,owner:t.id,x:t.x-dx*dist,y:t.y-dy*dist,
        armedAt:s.tick+MINE_ARM,ownerCleared:false};
      s.mines.push(mine);
      events.push({type:'mine-placed',mineId:mine.id,tankId:t.id,x:mine.x,y:mine.y,armedAt:mine.armedAt});
      if (--t.weaponAmmo===0) resetWeapon(t);
      continue;
    }
    if (t.weapon==='frag') {
      if (!pressed) continue;
      if (t.fragId===null) {
        t.fragId=shell(s,events,{owner:t.id,x:t.x,y:t.y,angle:t.angle,speed:4.5,ttl:FRAG_TTL,kind:'frag'}).id;
        t.weaponAmmo=0;
      } else {
        const b=s.bullets.find(b=>b.id===t.fragId);
        if (b) {
          s.bullets=s.bullets.filter(other=>other.id!==b.id);
          burst(b,s,events,'frag-burst',Math.atan2(b.vy,b.vx),deferred);
        }
        resetWeapon(t);
      }
      continue;
    }
    if (t.cooldown > 0 || s.bullets.filter(b=>b.owner===t.id&&b.kind==='shell').length >= MAX_SHELLS) {
      events.push({type:'shot-blocked', tankId:t.id, reason:t.cooldown>0?'cooldown':'shell-limit'});
      continue;
    }
    shell(s,events,{owner:t.id,x:t.x,y:t.y,angle:t.angle,speed:SHELL_SPEED,ttl:LIFETIME,kind:'shell'});
    t.cooldown=COOLDOWN;
  }
}

function advanceShell(b, s, events, impacts, deferred) {
  function expire(reason) {
    if (b.kind==='frag') {
      burst(b,s,events,'frag-burst',Math.atan2(b.vy,b.vx),deferred);
      const owner=s.tanks.find(t=>t.id===b.owner);
      if (owner?.fragId===b.id) resetWeapon(owner);
    }
    events.push({type:'shell-expired',bulletId:b.id,x:b.x,y:b.y,reason,kind:b.kind});
    return false;
  }
  if (b.ttl <= 0) return false;
  let remaining = 1;
  // Sweep through the remaining fraction after each bounce; hard cap guarantees
  // bounded work in degenerate geometry.
  for (let i=0;i<8 && remaining>EPS;i++) {
    const dx=b.vx*remaining, dy=b.vy*remaining;
    const wall=wallHit(b.x,b.y,dx,dy,s.walls);
    let target = null;
    for (const t of s.tanks) {
      if (!t.alive || (t.id===b.owner && !b.ownerArmed)) continue;
      const radius=TANK_RADIUS+BULLET_RADIUS;
      const overlapping=(b.x-t.x)**2+(b.y-t.y)**2<radius**2-EPS;
      const f=overlapping?0:circleHit(b.x,b.y,dx,dy,t.x,t.y,radius);
      if (f!==null && (!target || f<target.f-EPS)) target={t,f};
    }
    if (target && (!wall || target.f < wall.t-EPS)) {
      b.x+=dx*target.f; b.y+=dy*target.f;
      impacts.push({bullet:b,tankId:target.t.id,x:b.x,y:b.y});
      return b.kind==='frag'?expire('impact'):false;
    }
    if (!wall) {
      b.x+=dx; b.y+=dy;
      const owner=s.tanks.find(t=>t.id===b.owner);
      if (Math.hypot(b.x-owner.x,b.y-owner.y)>TANK_RADIUS+BULLET_RADIUS+EPS) b.ownerArmed=true;
      break;
    }
    b.x+=dx*wall.t; b.y+=dy*wall.t;
    bounceVelocity(b,wall.normals);
    b.ownerArmed=true;
    events.push({type:'bounce',bulletId:b.id,x:b.x,y:b.y,vx:b.vx,vy:b.vy});
    b.x+=b.vx*EPS; b.y+=b.vy*EPS;
    remaining*=1-wall.t;
    if (i===7 && remaining>EPS) {
      return expire('bounce-limit');
    }
  }
  b.ttl--;
  return b.ttl>0 || expire('ttl');
}

function awardPickups(s, events) {
  if (!s.config.pickups) return;
  const rng = {value:s.rng};
  if (s.tick % s.config.pickupInterval === 0 && s.pickups.length < 4) {
    const spots=[];
    for (let y=CELL/2;y<s.height;y+=CELL) for (let x=CELL/2;x<s.width;x+=CELL) {
      if (s.pickups.some(p=>p.x===x&&p.y===y) || s.tanks.some(t=>t.alive&&Math.hypot(t.x-x,t.y-y)<30)) continue;
      spots.push({x,y});
    }
    if (spots.length) {
      const p={id:'p'+s.nextPickup++,...spots[Math.floor(next(rng)*spots.length)],
        type:PICKUP_TYPES[Math.floor(next(rng)*PICKUP_TYPES.length)]};
      s.pickups.push(p);
      events.push({type:'pickup-spawn',pickupType:p.type,pickupId:p.id,x:p.x,y:p.y});
    }
  }
  s.pickups=s.pickups.filter(p=>{
    const candidates=s.tanks.filter(t=>t.alive&&!t.weapon&&Math.hypot(t.x-p.x,t.y-p.y)<=TANK_RADIUS+8);
    if (!candidates.length) return true;
    const distances=candidates.map(t=>Math.hypot(t.x-p.x,t.y-p.y));
    const minimum=Math.min(...distances);
    const tied=candidates.filter((_t,i)=>Math.abs(distances[i]-minimum)<=EPS);
    const winner=tied.length===1?tied[0]:tied[Math.floor(next(rng)*tied.length)];
    winner.weapon=p.type;
    winner.weaponAmmo=p.type==='gatling'?GATLING_AMMO:p.type==='mine'?3:1;
    events.push({type:'pickup',tankId:winner.id,pickupId:p.id,pickupType:p.type,x:p.x,y:p.y});
    return false;
  });
  s.rng=rng.value;
}

function advanceMines(s,events,deferred) {
  s.mines=s.mines.filter(m=>{
    const owner=s.tanks.find(t=>t.id===m.owner);
    if (!owner.alive||Math.hypot(owner.x-m.x,owner.y-m.y)>TANK_RADIUS+8) m.ownerCleared=true;
    if (s.tick<m.armedAt) return true;
    const victim=s.tanks.find(t=>t.alive&&(t.id!==m.owner||m.ownerCleared)&&Math.hypot(t.x-m.x,t.y-m.y)<=TANK_RADIUS+6);
    if (!victim) return true;
    burst(m,s,events,'mine-burst',0,deferred);
    return false;
  });
}

export function step(state, actions) {
  if (state.result) return {state,events:[],result:state.result};
  const s={...state,tick:state.tick+1,bullets:state.bullets.map(b=>({...b})),pickups:[...state.pickups],
    mines:state.mines.map(m=>({...m}))};
  const events=[], impacts=[], deferred=[];
  moveTanks(s,actions,events);
  fireShells(s,actions,events,impacts,deferred);
  s.bullets=s.bullets.filter(b=>advanceShell(b,s,events,impacts,deferred));
  advanceMines(s,events,deferred);
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
  const alive=s.tanks.filter(t=>t.alive);
  if (alive.length===0) s.result={winner:null,reason:s.tanks.length===2?'double-knockout':'mutual-knockout'};
  else if (alive.length===1) {
    if (s.settleUntil===null) {
      s.settleUntil=s.tick+SETTLE;
      events.push({type:'last-tank-pending',tankId:alive[0].id,settleUntil:s.settleUntil});
    }
    if (s.tick>=s.settleUntil) s.result={winner:alive[0].id,reason:'last-tank'};
  } else {
    awardPickups(s,events);
    if (s.tick>=s.config.maxTicks) s.result={winner:null,reason:'timeout'};
  }
  // The guide previews only geometry and stops earlier than a real shot. Freeze
  // nested geometry because the generic observation copies tank records shallowly.
  for (const t of s.tanks) t.aimGuide=t.alive&&t.weapon==='laser'
    ? Object.freeze(traceLaser(s,t,LASER_GUIDE,false).path.map(p=>Object.freeze(p))) : null;
  if (s.result) events.push({type:'ended',...s.result});
  return {state:s,events,result:s.result};
}
