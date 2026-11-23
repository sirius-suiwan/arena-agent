export const TICK_RATE = 60;
const CELL = 64, TANK_RADIUS = 12, BULLET_RADIUS = 3;
const MOVE = 2.2, TURN = 0.06, SHELL_SPEED = 6, LIFETIME = 300, COOLDOWN = 24;
const EPS = 1e-7, TAU = 2 * Math.PI;
const PICKUP_TYPES = ['shield', 'rapid'];
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
  if (!Array.isArray(players) || players.length !== 2 || new Set(players).size !== 2 ||
      players.some(x => typeof x !== 'string' || !x.trim() || x.length > 128)) {
    throw new TypeError('exactly two distinct nonempty string player IDs are required');
  }
  const c = normalizedConfig(config), rng = { value: seedValue(seed) };
  const width = c.cols * CELL, height = c.rows * CELL;
  const walls = generateMaze(c.cols, c.rows, rng);
  const spawns = [
    { x: CELL/2, y: CELL/2, angle: 0 },
    { x: width-CELL/2, y: height-CELL/2, angle: Math.PI }
  ];
  if (next(rng) < 0.5) spawns.reverse();
  return {
    tick: 0, width, height, walls, config: c, rng: rng.value, nextBullet: 1, nextPickup: 1,
    tanks: players.map((id,i) => ({ id, ...spawns[i], alive: true, cooldown: 0, shield: false, rapidUntil: 0 })),
    bullets: [], pickups: [], result: null
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
function wallHit(x,y,dx,dy,walls) {
  let best = null;
  function consider(t,nx,ny) {
    if (t < -EPS || t > 1+EPS || dx*nx+dy*ny >= -EPS) return;
    t = between(t,0,1);
    if (!best || t < best.t-EPS) best = { t, normals: [{nx,ny}] };
    else if (Math.abs(t-best.t) <= EPS && !best.normals.some(n => Math.abs(n.nx-nx)+Math.abs(n.ny-ny)<EPS)) {
      best.normals.push({nx,ny});
    }
  }
  for (const w of walls) {
    if (w.x1 === w.x2 && Math.abs(dx) > EPS) {
      const nx = -Math.sign(dx), t = (w.x1+nx*BULLET_RADIUS-x)/dx;
      const yy = y+t*dy;
      if (yy >= w.y1-EPS && yy <= w.y2+EPS) consider(t,nx,0);
    }
    if (w.y1 === w.y2 && Math.abs(dy) > EPS) {
      const ny = -Math.sign(dy), t = (w.y1+ny*BULLET_RADIUS-y)/dy;
      const xx = x+t*dx;
      if (xx >= w.x1-EPS && xx <= w.x2+EPS) consider(t,0,ny);
    }
    for (const [cx,cy] of [[w.x1,w.y1],[w.x2,w.y2]]) {
      const t = circleHit(x,y,dx,dy,cx,cy,BULLET_RADIUS);
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

function moveTanks(s, actions, events) {
  const proposed = s.tanks.map(t => {
    if (!t.alive) return { ...t };
    const a = Object.hasOwn(actions,t.id) ? actions[t.id] : { throttle: 0, turn: 0, fire: false };
    // Quantities are per game tick, not per wall-clock interval.
    const angle = ((t.angle+a.turn*TURN)%TAU+TAU)%TAU;
    const x = t.x+Math.cos(angle)*a.throttle*MOVE, y = t.y+Math.sin(angle)*a.throttle*MOVE;
    const blocked = s.walls.some(w => distanceToWallSquared(x,y,w) < TANK_RADIUS**2);
    if (blocked) events.push({ type:'wall-stop', tankId:t.id, x:t.x, y:t.y });
    return { ...t, x:blocked?t.x:x, y:blocked?t.y:y, angle, cooldown:Math.max(0,t.cooldown-1) };
  });
  if (proposed.every(t=>t.alive) && Math.hypot(proposed[0].x-proposed[1].x,proposed[0].y-proposed[1].y) < 2*TANK_RADIUS) {
    for (let i=0;i<2;i++) {
      proposed[i].x=s.tanks[i].x; proposed[i].y=s.tanks[i].y;
    }
    events.push({type:'tank-stop', tankIds:proposed.map(t=>t.id)});
  }
  s.tanks = proposed;
}

function fireShells(s, actions, events) {
  for (const t of s.tanks) {
    if (!t.alive || !Object.hasOwn(actions,t.id) || !actions[t.id].fire) continue;
    if (t.cooldown > 0 || s.bullets.filter(b=>b.owner===t.id).length >= MAX_SHELLS) {
      events.push({type:'shot-blocked', tankId:t.id, reason:t.cooldown>0?'cooldown':'shell-limit'});
      continue;
    }
    // Start at the tank center. The owner is immune only until the shell exits
    // its initial hull or bounces, so near-wall self hits are possible.
    const b = {id:'b'+s.nextBullet++, owner:t.id, x:t.x, y:t.y, vx:Math.cos(t.angle)*SHELL_SPEED,
      vy:Math.sin(t.angle)*SHELL_SPEED, ttl:LIFETIME, ownerArmed:false};
    t.cooldown = t.rapidUntil > s.tick ? COOLDOWN/2 : COOLDOWN;
    s.bullets.push(b);
    events.push({type:'shot',bulletId:b.id,tankId:t.id,x:b.x,y:b.y,vx:b.vx,vy:b.vy});
  }
}

function advanceShell(b, s, events, impacts) {
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
      return false;
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
      events.push({type:'shell-expired',bulletId:b.id,x:b.x,y:b.y,reason:'bounce-limit'});
      return false;
    }
  }
  b.ttl--;
  if (b.ttl===0) events.push({type:'shell-expired',bulletId:b.id,x:b.x,y:b.y,reason:'ttl'});
  return b.ttl>0;
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
    const candidates=s.tanks.filter(t=>t.alive&&Math.hypot(t.x-p.x,t.y-p.y)<=TANK_RADIUS+8);
    if (!candidates.length) return true;
    let winner=candidates[0];
    if (candidates.length===2) {
      const [a,b]=candidates;
      const diff=Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y);
      winner=Math.abs(diff)<=EPS?candidates[Math.floor(next(rng)*2)]:diff<0?a:b;
    }
    if (p.type==='shield') winner.shield=true;
    else winner.rapidUntil=s.tick+241;
    events.push({type:'pickup',tankId:winner.id,pickupId:p.id,pickupType:p.type,x:p.x,y:p.y});
    return false;
  });
  s.rng=rng.value;
}

export function step(state, actions) {
  if (state.result) return {state,events:[],result:state.result};
  const s={...state,tick:state.tick+1,bullets:state.bullets.map(b=>({...b})),pickups:[...state.pickups]};
  const events=[], impacts=[];
  moveTanks(s,actions,events);
  fireShells(s,actions,events);
  s.bullets=s.bullets.filter(b=>advanceShell(b,s,events,impacts));
  // Resolve all impacts against the same pre-damage movement snapshot. A shield
  // absorbs one shell in creation order; later same-tick hits still count.
  for (const impact of impacts) {
    const t=s.tanks.find(t=>t.id===impact.tankId), b=impact.bullet;
    const absorbed=t.shield;
    if (absorbed) t.shield=false;
    events.push({type:'hit',bulletId:b.id,tankId:t.id,ownerId:b.owner,x:impact.x,y:impact.y,absorbed});
    if (!absorbed&&t.alive) {
      t.alive=false;
      events.push({type:'destroyed',tankId:t.id,bulletId:b.id,ownerId:b.owner});
    }
  }
  awardPickups(s,events);
  const alive=s.tanks.filter(t=>t.alive);
  if (alive.length===0) s.result={winner:null,reason:'double-knockout'};
  else if (alive.length===1) s.result={winner:alive[0].id,reason:'last-tank'};
  else if (s.tick>=s.config.maxTicks) s.result={winner:null,reason:'timeout'};
  if (s.result) events.push({type:'ended',...s.result});
  return {state:s,events,result:s.result};
}
