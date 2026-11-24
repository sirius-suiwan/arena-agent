// Observation-only receding-horizon strategy for Arena Agent Tank Trouble.
const CELL=64, R=12, HORIZON=14;
// Reference distance for the route-time heuristic, not the actual movement rate.
const ROUTE_REFERENCE_STEP=2.2;
const EPS=1e-6;
const TURN_OPTIONS=[0,-1,1];
const MOVES= [0,1,-1].flatMap(throttle=>TURN_OPTIONS.map(turn=>({throttle,turn,fire:false})));
const neutral=()=>({throttle:0,turn:0,fire:false});
const d2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const wrap=(a)=>Math.atan2(Math.sin(a),Math.cos(a));
const heading=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const validProfile=profile=>['tickRate','forwardSpeed','reverseSpeed','turnSpeed',
  'shellLimit','shellSpeed','gatlingSpeed','missileSpeed','laserSpeed','laserTtl','remoteTurn']
  .every(key=>Number.isFinite(profile?.[key])&&profile[key]>0);
function kinetics(profile) {
  const {tickRate,forwardSpeed:f,reverseSpeed:b,turnSpeed:turn}=profile;
  return {f,b,turn,muzzle:profile.muzzleOffset??18,ticks:n=>Math.max(1,Math.round(n*tickRate/60)),
    routeTicks:n=>Math.max(1,Math.ceil(n*ROUTE_REFERENCE_STEP/f))};
}
const stepDistance=(throttle,physics)=>throttle*(throttle<0?physics.b:physics.f);

function flattenWalls(walls) {
  return walls.map(w=>({a:w.x1===w.x2?w.x1:w.y1,lo:w.x1===w.x2?w.y1:w.x1,
    hi:w.x1===w.x2?w.y2:w.x2,vert:w.x1===w.x2}));
}

function wallTime(x,y,vx,vy,maximum,walls,radius) {
  let t=maximum, hitX=false, hitY=false;
  for(const w of walls) {
    const v=w.vert?vx:vy;
    if(Math.abs(v)<EPS) continue;
    const at=(w.a-Math.sign(v)*radius-(w.vert?x:y))/v;
    if(at<=EPS || at>t+EPS) continue;
    const lateral=w.vert?y+at*vy:x+at*vx;
    if(lateral<w.lo-radius||lateral>w.hi+radius) continue;
    if(at<t-EPS){hitX=false;hitY=false;t=at;}
    if(w.vert) hitX=true; else hitY=true;
  }
  return {t,hitX,hitY};
}

function segments(x,y,vx,vy,time,walls,radius,maxBounces) {
  const out=[];
  for(let i=0;i<=maxBounces&&time>EPS;i++) {
    const w=wallTime(x,y,vx,vy,time,walls,radius);
    const nextX=x+w.t*vx,nextY=y+w.t*vy;
    out.push({x,y,nextX,nextY,t:w.t,vx,vy,bounced:i>0});
    if(!w.hitX&&!w.hitY) break;
    if(w.hitX) vx=-vx;
    if(w.hitY) vy=-vy;
    x=nextX+vx*EPS; y=nextY+vy*EPS;
    time-=w.t;
  }
  return out;
}

function tankIntersection(seg,tank,radius) {
  const dx=tank.x-seg.x,dy=tank.y-seg.y;
  const speed2=seg.vx**2+seg.vy**2;
  const projection=(dx*seg.vx+dy*seg.vy)/speed2;
  if(projection<0&&dx*dx+dy*dy>radius**2) return Infinity;
  const residual=radius*radius-(dx*dx+dy*dy-projection*projection*speed2);
  if(residual<0) return Infinity;
  const t=Math.max(0,projection-Math.sqrt(residual/speed2));
  return t<=seg.t ? t : Infinity;
}

function shot(me,angle,enemies,walls,weapon,speed,maxTime,profile) {
  const beam=weapon==='laser'||weapon==='death-ray';
  const dx=Math.cos(angle),dy=Math.sin(angle);
  const distance=profile?.muzzleOffset??(beam?18:0);
  const muzzle=wallTime(me.x,me.y,dx,dy,distance,walls,0).t;
  const parts=segments(me.x+Math.max(0,muzzle-EPS)*dx,me.y+Math.max(0,muzzle-EPS)*dy,
    dx*speed,dy*speed,maxTime,weapon==='death-ray'?[]:walls,beam?0:3,beam?8:2);
  let elapsed=0;
  for (const part of parts) {
    let min=Infinity,hit=null;
    if(part.bounced) min=tankIntersection(part,me,beam?R:R+3);
    if(min<Infinity) hit=me;
    for(const e of enemies) {
      const t=tankIntersection(part,e,beam?R:R+3);
      if(t<min) {min=t;hit=e;}
    }
    if(hit) return {hit:hit.id,travel:elapsed+min,bounced:part.bounced};
    elapsed+=part.t;
  }
  return null;
}

function newMap(obs) {
  const cols=obs.width/CELL,rows=obs.height/CELL;
  const edgeSet=new Set(obs.walls.map(w=>[w.x1,w.y1,w.x2,w.y2].join(',')));
  const links=Array.from({length:cols*rows},(_,i)=>{
    const x=i%cols,y=Math.floor(i/cols),cx=x*CELL,cy=y*CELL;
    const edge=(...xy)=>edgeSet.has(xy.join(','));
    const links=[];
    if(x>0&&!edge(cx,cy,cx,cy+CELL)) links.push(i-1);
    if(y>0&&!edge(cx,cy,cx+CELL,cy)) links.push(i-cols);
    if(x+1<cols&&!edge(cx+CELL,cy,cx+CELL,cy+CELL)) links.push(i+1);
    if(y+1<rows&&!edge(cx,cy+CELL,cx+CELL,cy+CELL)) links.push(i+cols);
    return links;
  });
  return {links,cols,walls:flattenWalls(obs.walls),
    index:({x,y})=>clamp(Math.floor(x/CELL),0,cols-1)+clamp(Math.floor(y/CELL),0,rows-1)*cols,
    center:i=>({x:(i%cols+0.5)*CELL,y:(Math.floor(i/cols)+0.5)*CELL})};
}

function bfs(map,start) {
  const costs=new Int16Array(map.links.length).fill(-1);
  const next=new Int16Array(map.links.length).fill(-1);
  const q=[start]; costs[start]=0;
  for(let i=0;i<q.length;i++) for(const n of map.links[q[i]]) if(costs[n]===-1) {
    costs[n]=costs[q[i]]+1;
    next[n]=q[i]===start?n:next[q[i]];
    q.push(n);
  }
  return {costs,next};
}

function nearWalls(point,walls,r) {
  return walls.filter(w=>{
    const axis=w.vert?point.x:point.y,side=w.vert?point.y:point.x;
    return Math.abs(axis-w.a)<=r&&side+r>=w.lo&&side-r<=w.hi;
  });
}

function canOccupy(x,y,walls) {
  for(const w of walls) {
    const axis=(w.vert?x:y)-w.a,lateral=w.vert?y:x;
    const side=lateral-clamp(lateral,w.lo,w.hi);
    if(axis*axis+side*side<R*R) return false;
  }
  return true;
}

function hazardTrack(me,projectiles,walls,physics) {
  const selected=projectiles.filter(b=>d2(me,b)<180**2)
    .sort((a,b)=>d2(me,a)-d2(me,b)).slice(0,16);
  const tracks=[];
  for (const b of selected) {
    const horizon=physics.ticks(HORIZON), life=Math.min(horizon,b.ttl??horizon);
    if(!Number.isFinite(b.vx+b.vy)||life<=0) continue;
    const radius=b.kind==='laser'||b.kind==='shrapnel'?0:3;
    const path=segments(b.x,b.y,b.vx,b.vy,life,walls,radius,b.kind==='shrapnel'?0:b.kind==='laser'?8:3);
    let t=0;
    for (const s of path) {
      const warmup=Math.max(0,Math.ceil(b.safeTicks??0)-t);
      if(b.kind==='laser') {
        const skip=Math.max(0,(b.safeDistance??0)/Math.hypot(s.vx,s.vy)-t);
        if(skip<s.t) tracks.push({...s,x:s.x+skip*s.vx,y:s.y+skip*s.vy,t:s.t-skip,start:t+skip});
      } else if(b.owner!==me.id||b.ownerArmed||s.bounced) {
        if(warmup<s.t) tracks.push({...s,x:s.x+warmup*s.vx,y:s.y+warmup*s.vy,t:s.t-warmup,start:t+warmup});
      }
      // Newly fired own shell: measure once its center leaves its owner's launch overlap.
      else {
        const speed=Math.hypot(s.vx,s.vy);
        if(speed>0.1) {
          const clear=Math.max(warmup,(16-Math.sqrt(d2(b,me)))/speed);
          if(clear<s.t) tracks.push({...s,x:s.x+clear*s.vx,y:s.y+clear*s.vy,t:s.t-clear,start:t+clear});
        }
      }
      t+=s.t;
    }
  }
  return tracks;
}

// Combat defense runs a separate high-accuracy sweep on already observed
// rounds. The muzzle/aim heuristic stays cheap; evasion cares about the
// rounded wall ends and the judge's move-tank-before-moving-shell timing.
function sweptWall(x,y,vx,vy,limit,walls,radius,axisBounce=false) {
  let time=limit,nx=0,ny=0,corner=false,found=false;
  function add(t,px,py) {
    if(t< -EPS||t>time+EPS||vx*px+vy*py>=-EPS) return;
    t=Math.max(0,t);
    if(!found||t<time-EPS) {time=t;nx=px;ny=py;corner=false;found=true;}
    else if(Math.abs(t-time)<=EPS&&Math.abs(nx*py-ny*px)>EPS) corner=true;
  }
  const vv=vx*vx+vy*vy;
  if(vv<EPS) return {time,found,vx,vy};
  for(const w of walls) {
    const flow=w.vert?vx:vy;
    if(Math.abs(flow)>EPS) {
      const normal=-Math.sign(flow);
      const t=(w.a+normal*radius-(w.vert?x:y))/flow;
      const cross=w.vert?y+t*vy:x+t*vx;
      if(cross>=w.lo-EPS&&cross<=w.hi+EPS) add(t,w.vert?normal:0,w.vert?0:normal);
    }
    if(radius===0) continue;
    for(let i=0;i<2;i++) {
      const end=i===0?w.lo:w.hi;
      const ex=x-(w.vert?w.a:end),ey=y-(w.vert?end:w.a);
      const approach=ex*vx+ey*vy;
      if(approach>=0) continue;
      const disc=approach*approach-vv*(ex*ex+ey*ey-radius*radius);
      if(disc<=0) continue;
      const t=(-approach-Math.sqrt(disc))/vv;
      if(t< -EPS||t>time+EPS) continue;
      const atX=ex+t*vx,atY=ey+t*vy,scale=Math.hypot(atX,atY);
      if(scale>EPS) add(t,atX/scale,atY/scale);
    }
  }
  if(corner) return {time,found,vx:-vx,vy:-vy};
  if(axisBounce) return {time,found,vx:Math.abs(nx)>EPS?-vx:vx,vy:Math.abs(ny)>EPS?-vy:vy};
  const dot=2*(vx*nx+vy*ny);
  return {time,found,vx:vx-dot*nx,vy:vy-dot*ny};
}

function candidateDefenseFrames(me,bullets,walls,horizon,physics,profile) {
  const frames=Array.from({length:horizon},()=>[]);
  const nearest=bullets.flatMap(b=>{
    const speed=Math.hypot(b.vx,b.vy),distance=Math.sqrt(d2(me,b));
    const life=Math.min(horizon,b.ttl??horizon);
    return Number.isFinite(speed)&&speed>EPS&&life>0&&distance<(speed+physics.f)*life+34
      ?[{b,life,speed,eta:Math.max(0,distance-37)/(speed+physics.f)}]:[];
  }).sort((a,b)=>a.eta-b.eta).slice(0,16);
  for(const {b,life,speed} of nearest) {
    const affected=nearWalls(b,walls,speed*life+4);
    const radius=b.kind==='laser'?0:b.kind==='gatling'?profile.gatlingRadius??3:b.kind==='shrapnel'?profile.fragmentRadius??3:3;
    const safeRadius=R+radius;
    function addTrack(x,y,vx,vy,start,end,armed) {
      // Approximate own-shell protection until it clears its initial firing
      // hull or hits its first wall. All other projectiles are already armed.
      const clear=b.kind==='laser'?(b.safeDistance??0)/speed:armed?0:Math.max(0,(safeRadius+1-Math.sqrt(d2(b,me)))/speed);
      const first=Math.max(start,clear,Math.ceil(b.safeTicks??0));
      for(let i=Math.max(0,Math.floor(first));i<horizon&&i<end-EPS;i++) {
        const from=Math.max(first,i)-start,to=Math.min(end,i+1)-start;
        if(from>=to) continue;
        const x0=x+vx*from,y0=y+vy*from,dx=vx*(to-from),dy=vy*(to-from);
        const lengths=dx*dx+dy*dy;
        if(lengths<EPS) continue;
        const reach=(i+1)*physics.f+safeRadius+8;
        if(Math.max(x0,x0+dx)<me.x-reach||Math.min(x0,x0+dx)>me.x+reach||
           Math.max(y0,y0+dy)<me.y-reach||Math.min(y0,y0+dy)>me.y+reach) continue;
        frames[i].push({x0,y0,dx,dy,il:1/lengths,safeRadius});
      }
    }
    let armed=b.owner!==me.id||b.ownerArmed;
    let x=b.x,y=b.y,vx=b.vx,vy=b.vy,start=0;
    for(let segment=0;segment<(b.kind==='laser'?12:7)&&start<life-EPS;segment++) {
      const hit=sweptWall(x,y,vx,vy,life-start,affected,radius,b.kind!=='shrapnel');
      const end=start+hit.time;
      addTrack(x,y,vx,vy,start,end,armed);
      if(!hit.found||b.kind==='shrapnel') break;
      x+=vx*hit.time+hit.vx*EPS;
      y+=vy*hit.time+hit.vy*EPS;
      vx=hit.vx;vy=hit.vy;start=end;armed=true;
    }
  }
  return frames;
}

function predictEscapeStep(p,move,frame,walls,enemies,physics) {
  const a=p.a+move.turn*physics.turn;
  const speed=stepDistance(move.throttle,physics);
  let x=p.x+speed*Math.cos(a),y=p.y+speed*Math.sin(a);
  if(!canOccupy(x,y,walls)||enemies.some(e=>(x-e.x)**2+(y-e.y)**2<(2*R)**2)) {x=p.x;y=p.y;}
  let hazard=0,hit=false;
  for(const s of frame) {
    const ox=x-s.x0,oy=y-s.y0;
    const along=clamp((ox*s.dx+oy*s.dy)*s.il,0,1);
    const miss=(ox-along*s.dx)**2+(oy-along*s.dy)**2;
    if(miss>=(s.safeRadius+7)**2) continue;
    hazard+=s.safeRadius+7-Math.sqrt(miss);
    if(miss<(s.safeRadius+0.8)**2) hit=true;
  }
  return {x,y,a,hazard,hit};
}

function tacticalDodge(me,preferred,bullets,mapWalls,enemies,zone,physics,profile,beams,tick) {
  const horizon=physics.ticks(32),stride=physics.ticks(6);
  const walls=nearWalls(me,mapWalls,horizon*physics.f+R+4);
  const frames=candidateDefenseFrames(me,bullets,mapWalls,horizon,physics,profile);
  for(const tank of beams) {
    const end=Math.min(horizon,tank.beamUntil-tick-1);
    for(let j=1;j<tank.beamPath.length;j++) {
      const a=tank.beamPath[j-1],b=tank.beamPath[j];
      const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
      if(len<=EPS||Math.min(d2(me,a),d2(me,b))>(horizon*physics.f+R+Math.sqrt(len))**2) continue;
      const segment={x0:a.x,y0:a.y,dx,dy,il:1/len,safeRadius:R+(profile.deathRayWidth??0)/2};
      for(let i=0;i<end;i++) frames[i].push(segment);
    }
  }
  if(!frames.some(frame=>frame.length)) return null;
  const start={x:me.x,y:me.y,a:me.angle,cost:0,first:null};
  const limit=(p,i)=>zone&&!insideRect(p,zone)
    ? Math.max(0,Math.max(Math.abs(p.x-zone.x)-zone.halfWidth,Math.abs(p.y-zone.y)-zone.halfHeight))*(i+1)/300 : 0;
  // If the intended input and its immediate continuation are clear, don't
  // cancel attacks over remote traffic. Plan against the first concrete risk.
  let direct=start,danger=false;
  for(let i=0;i<horizon;i++){
    const motion=i<stride?preferred:{...preferred,turn:0};
    direct=predictEscapeStep(direct,motion,frames[i],walls,enemies,physics);
    if(direct.hit) {danger=true;break;}
  }
  if(!danger) return null;
  let beam=[start],target=direct;
  for(let i=0;i<horizon;i+=stride) {
    const next=[];
    for(const p of beam) for(const move of MOVES) {
      let child=p,cost=p.cost;
      for(let j=i;j<Math.min(i+stride,horizon);j++){
        child=predictEscapeStep(child,move,frames[j],walls,enemies,physics);
        cost+=child.hazard*0.06+Number(child.hit)*(140+(horizon-j)*3)+limit(child,j);
      }
      const first=p.first??move;
      const drift=Math.hypot(child.x-target.x,child.y-target.y);
      const actionBias=i===0&&!(move.throttle===preferred.throttle&&move.turn===preferred.turn)?0.12:0;
      next.push({...child,cost:cost+actionBias,first,rank:cost+drift*0.012+actionBias});
    }
    next.sort((a,b)=>a.rank-b.rank);
    const distinct=new Set();
    beam=next.filter(c=>{
      const key=Math.round(c.x/3)+':'+Math.round(c.y/3)+':'+Math.round(wrap(c.a)*10);
      if(distinct.has(key)||distinct.size>=5) return false;
      distinct.add(key);return true;
    });
  }
  return beam[0]?.first??null;
}

// The aiming ray is approximate; before committing an ordinary shot, check
// its rounded-wall ricochet against the hull's intended short follow-through.
// This only vetoes the trigger, not movement or the normal defensive search.
function safeShellRelease(me,action,walls,others,physics,speed) {
  const horizon=physics.ticks(30),stride=physics.ticks(6);
  const span=(horizon+1)*Math.max(physics.f,physics.b)+R+4;
  const local=nearWalls(me,walls,span);
  const launch=predictEscapeStep({x:me.x,y:me.y,a:me.angle},action,[],local,others,physics);
  const ux=Math.cos(launch.a),uy=Math.sin(launch.a);
  const dx=ux*speed,dy=uy*speed;
  const muzzle=sweptWall(launch.x,launch.y,ux,uy,physics.muzzle,local,3);
  const offset=muzzle.found?Math.max(0,muzzle.time-EPS):physics.muzzle;
  const x=launch.x+ux*offset,y=launch.y+uy*offset;
  // Almost all shots never hit a wall in the preview, so avoid building a
  // prediction frame or trying alternate inputs for those shots.
  if(!sweptWall(x,y,dx,dy,horizon,nearWalls({x,y},walls,speed*horizon+4),3,true).found) return true;
  const bullet={x,y,vx:dx,vy:dy,owner:me.id,kind:'shell',ownerArmed:offset>=R+3,ttl:horizon};
  const frames=candidateDefenseFrames(me,[bullet],walls,horizon,physics,{});
  let hull={x:me.x,y:me.y,a:me.angle};
  for(let i=0;i<horizon;i++){
    hull=predictEscapeStep(hull,i<stride?action:{...action,turn:0},frames[i],local,others,physics);
    if(hull.hit) return false;
  }
  return true;
}

// Fragments are launched in a full circle. Prefer detonating from cover or
// far enough away to have time to react, not merely behind the warhead.
function coveredFromFrag(bomb,me,walls,physics,profile) {
  const radius=profile.fragmentRadius??3;
  const flight=(profile.fragmentBaseSpeed??128/profile.tickRate)+(profile.fragmentSpreadSpeed??144/profile.tickRate);
  const exposure=R+radius+flight*physics.ticks(23);
  const dx=me.x-bomb.x,dy=me.y-bomb.y,distance=Math.hypot(dx,dy);
  if(distance>=exposure) return true;
  const beforeHull=Math.max(0,1-(R+radius+3)/distance);
  if(beforeHull<=0) return false;
  const local=nearWalls(bomb,walls,distance+radius);
  return sweptWall(bomb.x,bomb.y,dx,dy,beforeHull,local,radius).found;
}

function routeAction(me,goal,walls,physics) {
  if(!goal||d2(me,goal)<8**2) return neutral();
  let da=wrap(heading(me,goal)-me.angle),throttle=1;
  if(Math.abs(da)>1.95) {throttle=-1;da=wrap(da+Math.PI);}
  const turn=Math.abs(da)>Math.max(0.031,physics.turn/2)?Math.sign(da):0;
  const a=me.angle+turn*physics.turn, step=stepDistance(throttle,physics);
  if(Math.abs(da)>0.42||!canOccupy(me.x+step*Math.cos(a),me.y+step*Math.sin(a),walls)) throttle=0;
  return {throttle,turn,fire:false};
}

// Prefer an actual escape trajectory over alternating blind reverse turns.
function recover(me,goal,walls,enemies,preferTurn,physics) {
  let best=null;
  for(const model of MOVES) {
    if(!model.throttle) continue;
    let x=me.x,y=me.y,a=me.angle,steps=0;
    for(let i=0;i<physics.ticks(11);i++) {
      a+=model.turn*physics.turn;
      const step=stepDistance(model.throttle,physics);
      const p={x:x+step*Math.cos(a),y:y+step*Math.sin(a)};
      if(!canOccupy(p.x,p.y,walls)||enemies.some(e=>d2(e,p)<(2*R)**2)) continue;
      x=p.x;y=p.y;steps++;
    }
    const p={x,y};
    const toward=goal?Math.sqrt(d2(me,goal))-Math.sqrt(d2(p,goal)):0;
    const value=steps*2+Math.sqrt(d2(me,p))+toward*0.35+Number(model.turn===preferTurn)*0.01;
    if(steps&&(!best||value>best.value)) best={...model,value};
  }
  return best?{throttle:best.throttle,turn:best.turn,fire:false}:{throttle:0,turn:preferTurn,fire:false};
}

// Minimum separation of two linear tracks over their common time window.
function trackGap(x,y,dx,dy,begin,bullet) {
  const left=Math.max(begin,bullet.start),right=Math.min(begin+1,bullet.start+bullet.t);
  if (right<left) return Infinity;
  const bx=bullet.x+bullet.vx*(left-bullet.start),by=bullet.y+bullet.vy*(left-bullet.start);
  const rx=x+dx*(left-begin)-bx,ry=y+dy*(left-begin)-by;
  const vx=dx-bullet.vx,vy=dy-bullet.vy,aa=vx*vx+vy*vy;
  const t=aa>EPS?clamp(-(rx*vx+ry*vy)/aa,0,right-left):0;
  return (rx+t*vx)**2+(ry+t*vy)**2;
}

function safety(me,action,walls,bullets,mines,enemies,roundTick,physics) {
  let risk=0,x=me.x,y=me.y,a=me.angle;
  for(let i=0;i<physics.ticks(HORIZON);i++) {
    // Evaluate a short committed action, then allow its turn to stop.
    if(i<physics.ticks(6)) a+=action.turn*physics.turn;
    const step=stepDistance(action.throttle,physics);
    let dx=step*Math.cos(a),dy=step*Math.sin(a);
    const p={x:x+dx,y:y+dy};
    if(!canOccupy(p.x,p.y,walls)||enemies.some(e=>d2(e,p)<(2*R)**2)) {dx=0;dy=0;}
    for(const b of bullets) {
      const gap=trackGap(x,y,dx,dy,i,b);
      if(gap<33**2) risk+=((33-Math.sqrt(gap))*0.7+(gap<16**2?80:0))/(1+i*0.13);
    }
    x+=dx;y+=dy;
    for(const m of mines) {
      if((m.armedAt??0)>roundTick+i) continue;
      const gap=(m.x-x)**2+(m.y-y)**2;
      if(gap<28**2) risk+=(gap<18**2?75:0)+(28-Math.sqrt(gap))*0.5;
    }
  }
  return {risk,x,y};
}

function aimPlan(me,enemies,walls,weapon,speed,tick,physics,laserRange,profile) {
  const beam=weapon==='laser'||weapon==='death-ray';
  const shotSpeed=beam?1:speed;
  const maxTime=beam ? (weapon==='laser'?laserRange:1000) : physics.ticks(58);
  const direct=enemies.slice(0,3).map(e=>heading(me,e));
  const candidates=[me.angle,me.angle-physics.turn,me.angle+physics.turn,...direct];
  // Mirror targets across nearby wall axes for one-bank candidates; actual
  // tracing rejects imaginary shots behind walls or hits on ourselves.
  if(weapon!=='death-ray'&&tick%physics.ticks(2)===0) {
    const axes=new Set();
    for(const w of nearWalls(me,walls,130)) {
      const key=(w.vert?'x':'y')+w.a;
      if(axes.has(key)||axes.size>=9) continue;
      axes.add(key);
      for(const enemy of enemies.slice(0,2)) {
        const p=w.vert?{x:2*w.a-enemy.x,y:enemy.y}:{x:enemy.x,y:2*w.a-enemy.y};
        candidates.push(heading(me,p));
      }
    }
  }
  let best=null;
  for(const a of candidates) {
    const h=shot(me,a,enemies,walls,weapon,shotSpeed,maxTime,profile);
    if(!h||h.hit===me.id) continue;
    const err=Math.abs(wrap(a-me.angle));
    let cost=err*18+h.travel*(beam?0.014:0.24)+(h.bounced?5:0);
    if(err>1.2&&h.bounced) cost+=14;
    if(best===null||cost<best.cost) best={angle:a,cost};
  }
  return best;
}

// A ready cannon doesn't need a dedicated stop-and-aim phase when the next
// legal pose already has a clean close shot. Steering and displacement happen
// before firing in Classic; trace from that pose, not from the observed barrel.
function closeAttack(me,preferred,enemies,walls,obstacles,physics,speed,pursuingCrate,allowShot) {
  const close=enemies.filter(enemy=>d2(me,enemy)<150**2);
  if(!close.length) return null;
  const options=[preferred];
  for(const turn of TURN_OPTIONS) if(turn!==preferred.turn) options.push({...preferred,turn});
  // A nearby firing window can justify a single stationary tick when moving
  // would put the muzzle behind an edge. Don't start a separate aim hold.
  if(preferred.throttle) for(const turn of TURN_OPTIONS) options.push({throttle:0,turn,fire:false});
  const maxTravel=physics.ticks(58);
  for(const a of options) {
    const angle=me.angle+a.turn*physics.turn,step=stepDistance(a.throttle,physics);
    const pos={x:me.x+step*Math.cos(angle),y:me.y+step*Math.sin(angle)};
    const moves=canOccupy(pos.x,pos.y,obstacles)&&!enemies.some(e=>d2(e,pos)<(2*R)**2);
    const muzzle={...me,...(moves?pos:{}),angle};
    const hit=shot(muzzle,angle,enemies,walls,null,speed,maxTravel);
    if(!hit||hit.hit===me.id||!close.some(t=>t.id===hit.hit)) continue;
    // Avoid committing to long speculative banks or stopping for crate-side pokes.
    if(hit.bounced&&hit.travel>physics.ticks(36) || pursuingCrate&&!a.throttle&&preferred.throttle&&hit.travel>physics.ticks(30)) continue;
    if(allowShot(a)) return {...a,fire:true};
  }
  return null;
}

// Add a direct firing window against a reliably moving tank. This predicts
// only from visible pose deltas, never from submitted opponent actions.
function interceptAdvance(me,route,targets,motion,walls,obstacles,others,physics,speed,allowShot) {
  const horizon=physics.ticks(25);
  const crossing=targets.slice(0,3).flatMap(t=>{
    const v=motion.get(t.id);
    if(!v||v.steady<physics.ticks(4)||d2(me,t)>110**2||d2(me,t)<24**2) return [];
    const wall=sweptWall(t.x,t.y,v.dx,v.dy,horizon,nearWalls(t,walls,horizon*physics.f+R),R);
    const life=wall.found?wall.time:horizon;
    return life>0?[{t,v,life}]:[];
  });
  if(!crossing.length) return null;
  const nearby=nearWalls(me,walls,horizon*speed+physics.f+4);
  const turns=[route.turn,...TURN_OPTIONS.filter(t=>t!==route.turn)];
  for(const turn of turns) {
    const move={...route,turn};
    const pose=predictEscapeStep({x:me.x,y:me.y,a:me.angle},move,[],obstacles,others,physics);
    if(move.throttle&&d2(me,pose)<EPS) continue;
    const vx=Math.cos(pose.a)*speed,vy=Math.sin(pose.a)*speed;
    const wall=sweptWall(pose.x,pose.y,vx,vy,horizon,nearby,3);
    for(const {t,v,life} of crossing) {
      // A smaller aim radius is deliberate: a marginal intercept isn't
      // worth spending ammo on extrapolation of the enemy's next move.
      const seg={x:pose.x,y:pose.y,t:Math.min(life,wall.time),vx:vx-v.dx,vy:vy-v.dy};
      if(seg.vx**2+seg.vy**2>EPS&&tankIntersection(seg,t,R-3)<seg.t&&allowShot(move)) {
        return {...move,fire:true};
      }
    }
  }
  return null;
}

function observeMotion(previous,tanks,tick,physics) {
  const current=new Map();
  for(const t of tanks) {
    const prev=previous.get(t.id);
    const dx=t.x-(prev?.x??t.x),dy=t.y-(prev?.y??t.y);
    const moving=prev?.tick===tick-1&&dx*dx+dy*dy>(physics.b*0.55)**2;
    const smooth=moving&&((dx-prev.dx)**2+(dy-prev.dy)**2)<(physics.b*0.42)**2;
    current.set(t.id,{x:t.x,y:t.y,dx,dy,tick,steady:smooth?prev.steady+1:Number(moving)});
  }
  return current;
}

function zoneAt(zone,tick) {
  const f=clamp((tick-zone.startTick)/Math.max(1,zone.endTick-zone.startTick),0,1);
  return {
    x:zone.x,y:zone.y,
    halfWidth:zone.initialHalfWidth+(zone.finalHalfWidth-zone.initialHalfWidth)*f,
    halfHeight:zone.initialHalfHeight+(zone.finalHalfHeight-zone.initialHalfHeight)*f
  };
}

function insideRect(p,z,margin=0) {
  return Math.abs(p.x-z.x)+margin<=z.halfWidth&&Math.abs(p.y-z.y)+margin<=z.halfHeight;
}

function zoneNavigation(zone,me,map,costs,tick,physics) {
  if(!zone||me.invulnerable||![zone.x,zone.y,zone.halfWidth,zone.halfHeight,zone.initialHalfWidth,zone.initialHalfHeight,
    zone.finalHalfWidth,zone.finalHalfHeight,zone.startTick,zone.endTick].every(Number.isFinite)) return null;
  let shelter=null,score=Infinity;
  for(let i=0;i<costs.length;i++) if(costs[i]>=0) {
    const p=map.center(i), eta=costs[i]*physics.routeTicks(45)+physics.ticks(35);
    const projected=zoneAt(zone,tick+eta+physics.ticks(70));
    const dx=Math.abs(p.x-zone.x),dy=Math.abs(p.y-zone.y);
    const over=Math.max(0,dx+15-projected.halfWidth)+Math.max(0,dy+15-projected.halfHeight);
    const rank=over*30+eta*0.35+Math.hypot(dx,dy)*0.6;
    if(rank<score) {score=rank;shelter={...p,eta};}
  }
  if(!shelter) return null;
  const future=zoneAt(zone,tick+shelter.eta+physics.ticks(55));
  const pressure=!insideRect(me,zone)||!insideRect(me,future,24);
  return {pressure,shelter,crateSafe:(p,eta)=>insideRect(p,zoneAt(zone,tick+eta+physics.ticks(45)),18)};
}

export function makePolicy() {
  let map=null,round=null,oldPose=null,stuck=0,escape=null,waypoint=null,cornerCell=-1,steer=1;
  let lockAim=null,aimStarted=null,navUntil=0;
  let routeCache=null,routeCell=-1,motion=new Map();
  return obs=>{
    if (!Array.isArray(obs?.tanks)||!Array.isArray(obs.walls)||!Array.isArray(obs.bullets)||!validProfile(obs.profile)) return neutral();
    const me=obs.tanks.find(t=>t.id===obs.playerId&&t.alive);
    if(!me||obs.phase==='intermission') return neutral();
    if(!map||round!==(obs.round??1)) {
      map=newMap(obs);round=obs.round??1;oldPose=null;stuck=0;escape=null;waypoint=null;cornerCell=-1;steer=1;
      lockAim=null;aimStarted=null;navUntil=0;
      routeCache=null;routeCell=-1;motion=new Map();
    }
    const tick=obs.roundTick??obs.tick??0;
    const profile=obs.profile, physics=kinetics(profile);
    const enemies=obs.tanks.filter(t=>t.alive&&t.id!==me.id).sort((a,b)=>d2(me,a)-d2(me,b));
    motion=observeMotion(motion,enemies,tick,physics);
    const nearbyEnemies=enemies.filter(t=>d2(me,t)<500**2).slice(0,4);
    const obstacles=nearWalls(me,map.walls,60);
    const ammo=obs.bullets.reduce((n,b)=>n+Number(b.owner===me.id&&b.kind==='shell'),0);
    const armed=ammo<profile.shellLimit;
    const cell=map.index(me);
    if(routeCell!==cell) {routeCache=bfs(map,cell);routeCell=cell;}
    const {costs,next}=routeCache;
    const nearest=enemies.reduce((a,b)=>!a||costs[map.index(b)]<costs[map.index(a)]?b:a,null);
    const safe=zoneNavigation(obs.zone,me,map,costs,tick,physics),zonePressure=safe?.pressure===true;
    // Empty weapon slot: gather a reachable crate before chasing. A slightly
    // longer path to a strong weapon beats an equally close mine, not all mines.
    const supplies=zonePressure?[]:(obs.pickups??[]).filter(p=>{
      if(p.type==='shield'?me.shield:me.weapon) return false;
      const cost=costs[map.index(p)];
      return cost>=0&&cost<=8&&(!safe||safe.crateSafe(p,cost*physics.routeTicks(45)+physics.ticks(35)));
    }).sort((a,b)=>{
      const value=p=>costs[map.index(p)]*1.2+Math.sqrt(d2(me,p))/160+Number(p.type==='mine')*0.45;
      return value(a)-value(b);
    });
    const supply=supplies[0];
    let destination=zonePressure?safe.shelter:supply??nearest;
    if(!zonePressure&&!supply&&!armed&&!me.weapon&&nearest&&d2(me,nearest)<185**2) {
      let best=-Infinity;
      const foe=map.index(nearest);
      const avoid=bfs(map,foe).costs;
      for(let i=0;i<costs.length;i++) if(costs[i]>0&&costs[i]<5) {
        const value=avoid[i]-costs[i]*0.25;
        if(value>best){best=value;destination=map.center(i);}
      }
    }
    let goal=destination;
    if(destination) {
      const destCell=map.index(destination);
      if(waypoint&&d2(me,waypoint)>8**2&&map.index(waypoint)===cell&&waypoint.destination===(destination.id??destCell)) goal=waypoint;
      else if(next[destCell]>=0) {goal={...map.center(next[destCell]),destination:destination.id??destCell};waypoint=goal;}
      else waypoint=null;
    } else waypoint=null;
    if(cornerCell!==cell) cornerCell=-1;
    const center=map.center(cell);
    if(cornerCell===cell&&d2(me,center)<=8**2) cornerCell=-1;
    let route=routeAction(me,cornerCell===cell?center:goal,obstacles,physics);
    // If the hull cannot take the guessed diagonal through an opening, round
    // the wall end from the center of the current cell before retrying.
    if(goal&&d2(me,goal)>8**2&&!route.throttle&&!route.turn&&d2(me,center)>8**2){
      cornerCell=cell;
      route=routeAction(me,center,obstacles,physics);
    }
    const hasRoute=Boolean(goal&&d2(me,goal)>8**2);
    if(oldPose?.navigating&&hasRoute) {
      const idle=d2(oldPose,me)<0.15;
      const rotating=Math.abs(wrap(me.angle-oldPose.angle))>0.02;
      const reversal=route.turn&&Math.sign(oldPose.turn)===-Math.sign(route.turn);
      if(idle&&(oldPose.throttle||!rotating||reversal)) stuck++;
      else stuck=Math.max(0,stuck-1);
    } else stuck=0;
    if(stuck>=physics.ticks(7)&&!escape) {
      steer=-steer;escape={action:recover(me,goal,obstacles,nearbyEnemies,steer,physics),until:tick+physics.ticks(10)};
      waypoint=null;cornerCell=-1;stuck=0;navUntil=tick+physics.ticks(17);aimStarted=null;lockAim=null;
    }
    let preferred=route,navigating=hasRoute;
    const weapon=me.weapon;
    const shotSpeed=weapon==='gatling'?profile.gatlingSpeed
      :['frag','missile','remote'].includes(weapon)?profile.missileSpeed:profile.shellSpeed;
    const laserRange=profile.laserSpeed*profile.laserTtl;
    const ready=weapon?!(weapon==='gatling'&&(me.weaponGap>0||me.weaponAmmo===0)):armed;
    const canUse=ready&&weapon!=='mine'&&!(['frag','missile','remote'].includes(weapon)&&me.fragId);
    if(!zonePressure&&canUse&&nearbyEnemies.length&&tick>=navUntil) {
      const beam=weapon==='laser'||weapon==='death-ray';
      const canPress=!me.fireHeld;
      const directRange=beam?(weapon==='laser'?laserRange:576):physics.ticks(58);
      const currentShot=shot(me,me.angle,nearbyEnemies,map.walls,weapon,beam?1:shotSpeed,directRange,profile);
      const immediatelyUseful=currentShot&&currentShot.hit!==me.id&&currentShot.travel<=(beam?12:physics.ticks(12));
      if(supply) {
        // One quick shot is worth taking; waiting or turning repeatedly over a
        // promising long-range shot is not worth abandoning a crate.
        lockAim=null;aimStarted=null;
        if(immediatelyUseful&&canPress) {
          preferred={...neutral(),fire:true};
          navigating=false;
        }
      } else {
        // Keep an aim for a few ticks to avoid oscillating between banks/targets.
        if(!lockAim||tick-lockAim.tick>=physics.ticks(4)) {
          const plan=aimPlan(me,nearbyEnemies,map.walls,weapon,shotSpeed,tick,physics,laserRange,profile);
          lockAim=plan?{...plan,tick}:null;
        }
        if(lockAim) {
          const err=wrap(lockAim.angle-me.angle);
          if(Math.abs(err)<0.8||(weapon&&weapon!=='gatling')) {
            aimStarted??=tick;
            if(tick-aimStarted>=physics.ticks(13)) {
              navUntil=tick+physics.ticks(11);lockAim=null;aimStarted=null;
            } else {
              preferred={throttle:0,turn:Math.abs(err)>Math.max(0.03,physics.turn/2)?Math.sign(err):0,fire:false};
              navigating=false;
              if(Math.abs(err)<0.12) {
                const h=shot(me,me.angle+preferred.turn*physics.turn,nearbyEnemies,map.walls,weapon,beam?1:shotSpeed,directRange,profile);
                preferred.fire=Boolean(h&&h.hit!==me.id&&canPress);
              }
            }
          }
        } else aimStarted=null;
      }
    } else {lockAim=null;aimStarted=null;}
    if(weapon==='gatling'&&me.weaponCharge>0&&(me.weaponAmmo??1)>0&&!zonePressure) preferred={...preferred,fire:true};
    if(!zonePressure&&weapon==='frag'&&me.fragId&&!me.fireHeld) {
      const bomb=obs.bullets.find(b=>b.id===me.fragId);
      if(bomb&&d2(me,bomb)>75**2&&enemies.some(e=>d2(e,bomb)<70**2)&&
        coveredFromFrag(bomb,me,map.walls,physics,profile)) preferred.fire=true;
    }
    if(!zonePressure&&weapon==='mine'&&!me.fireHeld&&enemies[0]&&d2(me,enemies[0])<110**2&&
      Math.abs(wrap(heading(me,enemies[0])-me.angle))>2.0) preferred.fire=true;
    if(escape&&tick>=escape.until) escape=null;
    if(escape) {preferred=escape.action;navigating=false;}
    const allowShot=action=>safeShellRelease(me,action,map.walls,nearbyEnemies,physics,profile.shellSpeed);
    if(preferred.fire&&!weapon&&!allowShot(preferred)) {
      // Don't retry a known bad firing pose or wait out the aim timer.
      preferred={...route};navigating=hasRoute;
    }
    if(!preferred.fire&&!weapon&&armed&&!me.fireHeld&&!escape&&!zonePressure&&nearbyEnemies.length) {
      const window=closeAttack(me,preferred,nearbyEnemies,map.walls,obstacles,physics,profile.shellSpeed,Boolean(supply),allowShot);
      const intercept=window??interceptAdvance(me,route,nearbyEnemies,motion,map.walls,obstacles,nearbyEnemies,
        physics,profile.shellSpeed,allowShot);
      if(intercept) {preferred=intercept;navigating=Boolean(intercept.throttle)&&hasRoute;}
    }
    const mineThreat=(obs.mines??[]).filter(m=>d2(me,m)<65**2);
    const projectiles=hazardTrack(me,obs.bullets,map.walls,physics);
    if(projectiles.length||mineThreat.length) {
      const before=safety(me,preferred,obstacles,projectiles,mineThreat,nearbyEnemies,tick,physics);
      if(before.risk>2.5) {
        const base={x:before.x,y:before.y};
        let best=before.risk, candidate=preferred;
        for(const model of MOVES) {
          const run=safety(me,model,obstacles,projectiles,mineThreat,nearbyEnemies,tick,physics);
          const cost=run.risk+Math.sqrt(d2(run,base))*0.013+0.15;
          if(cost<best){best=cost;candidate=model;}
        }
        if(candidate!==preferred) navigating=false;
        preferred={...candidate};
      }
    }
    const beams=enemies.filter(t=>Array.isArray(t.beamPath)&&t.beamUntil>tick&&
      (obs.friendlyFire||obs.teams?.[me.id]===undefined||obs.teams[t.id]!==obs.teams[me.id]));
    if((obs.bullets.length||beams.length)&&!me.invulnerable&&!(weapon==='remote'&&me.fragId)&&!(weapon==='death-ray'&&me.weaponCharge>0)) {
      const evasive=tacticalDodge(me,preferred,obs.bullets,map.walls,nearbyEnemies,obs.zone,physics,profile,beams,tick);
      if(evasive&&(evasive.throttle!==preferred.throttle||evasive.turn!==preferred.turn)) {
        preferred={...evasive};navigating=false;
      }
    }
    if(weapon==='remote'&&me.fragId) {
      const missile=obs.bullets.find(b=>b.id===me.fragId);
      if(missile&&nearest) {
        const error=wrap(heading(missile,nearest)-(missile.heading??Math.atan2(missile.vy,missile.vx)));
        preferred={throttle:0,turn:Math.abs(error)>profile.remoteTurn/2?Math.sign(error):0,fire:false};
        navigating=false;
      }
    }
    if(weapon==='death-ray'&&me.weaponCharge>0||weapon==='laser'&&me.fragId) {preferred=neutral();navigating=false;}
    oldPose={x:me.x,y:me.y,angle:me.angle,throttle:preferred.throttle,turn:preferred.turn,navigating};
    return preferred;
  };
}
