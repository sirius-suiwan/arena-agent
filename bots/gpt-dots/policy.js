// Observation-only receding-horizon strategy for Arena Agent Tank Trouble.
const CELL=64, R=12, MOVE=2.2, TURN=0.06, HORIZON=14;
const EPS=1e-6;
const TURN_OPTIONS=[0,-1,1];
const MOVES= [0,1,-1].flatMap(throttle=>TURN_OPTIONS.map(turn=>({throttle,turn,fire:false})));
const neutral=()=>({throttle:0,turn:0,fire:false});
const d2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const wrap=(a)=>Math.atan2(Math.sin(a),Math.cos(a));
const heading=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

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

function shot(me,angle,enemies,walls,weapon,speed,maxTime) {
  const beam=weapon==='laser'||weapon==='death-ray';
  const parts=segments(me.x,me.y,Math.cos(angle)*speed,Math.sin(angle)*speed,maxTime,
    weapon==='death-ray'?[]:walls,beam?0:3,beam?5:2);
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

function hazardTrack(me,projectiles,walls) {
  const selected=projectiles.filter(b=>d2(me,b)<180**2)
    .sort((a,b)=>d2(me,a)-d2(me,b)).slice(0,16);
  const tracks=[];
  for (const b of selected) {
    const life=Math.min(HORIZON,b.ttl??HORIZON);
    if(!Number.isFinite(b.vx+b.vy)||life<=0) continue;
    const path=segments(b.x,b.y,b.vx,b.vy,life,walls,3,3);
    let t=0;
    for (const s of path) {
      if(b.owner!==me.id||b.ownerArmed||s.bounced) tracks.push({...s,start:t});
      // Newly fired own shell: measure once its center leaves its owner's launch overlap.
      else {
        const speed=Math.hypot(s.vx,s.vy);
        if(speed>0.1) {
          const clear=Math.max(0,(16-Math.sqrt(d2(b,me)))/speed);
          if(clear<s.t) tracks.push({...s,x:s.x+clear*s.vx,y:s.y+clear*s.vy,t:s.t-clear,start:t+clear});
        }
      }
      t+=s.t;
    }
  }
  return tracks;
}

function routeAction(me,goal,walls) {
  if(!goal||d2(me,goal)<8**2) return neutral();
  let da=wrap(heading(me,goal)-me.angle),throttle=1;
  if(Math.abs(da)>1.95) {throttle=-1;da=wrap(da+Math.PI);}
  const turn=Math.abs(da)>0.031?Math.sign(da):0;
  const a=me.angle+turn*TURN;
  if(Math.abs(da)>0.42||!canOccupy(me.x+MOVE*throttle*Math.cos(a),me.y+MOVE*throttle*Math.sin(a),walls)) throttle=0;
  return {throttle,turn,fire:false};
}

// Prefer an actual escape trajectory over alternating blind reverse turns.
function recover(me,goal,walls,enemies,preferTurn) {
  let best=null;
  for(const model of MOVES) {
    if(!model.throttle) continue;
    let x=me.x,y=me.y,a=me.angle,steps=0;
    for(let i=0;i<11;i++) {
      a+=model.turn*TURN;
      const p={x:x+model.throttle*MOVE*Math.cos(a),y:y+model.throttle*MOVE*Math.sin(a)};
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

function safety(me,action,walls,bullets,mines,enemies,roundTick) {
  let risk=0,x=me.x,y=me.y,a=me.angle;
  for(let i=0;i<HORIZON;i++) {
    // Evaluate a short committed action, then allow its turn to stop.
    if(i<6) a+=action.turn*TURN;
    let dx=action.throttle*MOVE*Math.cos(a),dy=action.throttle*MOVE*Math.sin(a);
    const p={x:x+dx,y:y+dy};
    if(!canOccupy(p.x,p.y,walls)||enemies.some(e=>d2(e,p)<(2*R)**2)) {dx=0;dy=0;}
    for(const b of bullets) {
      const gap=trackGap(x,y,dx,dy,i,b);
      if(gap<33**2) risk+=((33-Math.sqrt(gap))*0.7+(gap<16**2?80:0))/(1+i*0.13);
    }
    x+=dx;y+=dy;
    for(const m of mines) {
      if((m.armedAt??0)>roundTick+i||(m.owner===me.id&&!m.ownerCleared)) continue;
      const gap=(m.x-x)**2+(m.y-y)**2;
      if(gap<28**2) risk+=(gap<18**2?75:0)+(28-Math.sqrt(gap))*0.5;
    }
  }
  return {risk,x,y};
}

function aimPlan(me,enemies,walls,weapon,speed,tick) {
  const beam=weapon==='laser'||weapon==='death-ray';
  const shotSpeed=beam?1:speed;
  const maxTime=beam ? (weapon==='laser'?576:1000) : 58;
  const direct=enemies.slice(0,3).map(e=>heading(me,e));
  const candidates=[me.angle,me.angle-TURN,me.angle+TURN,...direct];
  // Mirror targets across nearby wall axes for one-bank candidates; actual
  // tracing rejects imaginary shots behind walls or hits on ourselves.
  if(weapon!=='death-ray'&&tick%2===0) {
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
    const h=shot(me,a,enemies,walls,weapon,shotSpeed,maxTime);
    if(!h||h.hit===me.id) continue;
    const err=Math.abs(wrap(a-me.angle));
    let cost=err*18+h.travel*(beam?0.014:0.24)+(h.bounced?5:0);
    if(err>1.2&&h.bounced) cost+=14;
    if(best===null||cost<best.cost) best={angle:a,cost};
  }
  return best;
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

function zoneNavigation(zone,me,map,costs,tick) {
  if(!zone||me.invulnerable||![zone.x,zone.y,zone.halfWidth,zone.halfHeight,zone.initialHalfWidth,zone.initialHalfHeight,
    zone.finalHalfWidth,zone.finalHalfHeight,zone.startTick,zone.endTick].every(Number.isFinite)) return null;
  let shelter=null,score=Infinity;
  for(let i=0;i<costs.length;i++) if(costs[i]>=0) {
    const p=map.center(i), eta=costs[i]*45+35;
    const projected=zoneAt(zone,tick+eta+70);
    const dx=Math.abs(p.x-zone.x),dy=Math.abs(p.y-zone.y);
    const over=Math.max(0,dx+15-projected.halfWidth)+Math.max(0,dy+15-projected.halfHeight);
    const rank=over*30+eta*0.35+Math.hypot(dx,dy)*0.6;
    if(rank<score) {score=rank;shelter={...p,eta};}
  }
  if(!shelter) return null;
  const future=zoneAt(zone,tick+shelter.eta+55);
  const pressure=!insideRect(me,zone)||!insideRect(me,future,24);
  return {pressure,shelter,crateSafe:(p,eta)=>insideRect(p,zoneAt(zone,tick+eta+45),18)};
}

export function makePolicy() {
  let map=null,round=null,oldPose=null,stuck=0,escape=null,waypoint=null,cornerCell=-1,steer=1;
  let lockAim=null,aimStarted=null,navUntil=0;
  let routeCache=null,routeCell=-1;
  return obs=>{
    if (!Array.isArray(obs?.tanks)||!Array.isArray(obs.walls)||!Array.isArray(obs.bullets)) return neutral();
    const me=obs.tanks.find(t=>t.id===obs.playerId&&t.alive);
    if(!me||obs.phase==='intermission') return neutral();
    if(!map||round!==(obs.round??1)) {
      map=newMap(obs);round=obs.round??1;oldPose=null;stuck=0;escape=null;waypoint=null;cornerCell=-1;steer=1;
      lockAim=null;aimStarted=null;navUntil=0;
      routeCache=null;routeCell=-1;
    }
    const tick=obs.roundTick??obs.tick??0;
    const enemies=obs.tanks.filter(t=>t.alive&&t.id!==me.id).sort((a,b)=>d2(me,a)-d2(me,b));
    const nearbyEnemies=enemies.filter(t=>d2(me,t)<500**2).slice(0,4);
    const obstacles=nearWalls(me,map.walls,60);
    const ammo=obs.bullets.reduce((n,b)=>n+Number(b.owner===me.id&&(b.kind==='shell'||b.kind===undefined)),0);
    const armed=ammo<(obs.shellLimit??5);
    const cell=map.index(me);
    if(routeCell!==cell) {routeCache=bfs(map,cell);routeCell=cell;}
    const {costs,next}=routeCache;
    const nearest=enemies.reduce((a,b)=>!a||costs[map.index(b)]<costs[map.index(a)]?b:a,null);
    const safe=zoneNavigation(obs.zone,me,map,costs,tick),zonePressure=safe?.pressure===true;
    // Empty weapon slot: gather a reachable crate before chasing. A slightly
    // longer path to a strong weapon beats an equally close mine, not all mines.
    const supplies=me.weapon||zonePressure?[]:(obs.pickups??[]).filter(p=>{
      const cost=costs[map.index(p)];
      return cost>=0&&cost<=8&&(!safe||safe.crateSafe(p,cost*45+35));
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
    let route=routeAction(me,cornerCell===cell?center:goal,obstacles);
    // If the hull cannot take the guessed diagonal through an opening, round
    // the wall end from the center of the current cell before retrying.
    if(goal&&d2(me,goal)>8**2&&!route.throttle&&!route.turn&&d2(me,center)>8**2){
      cornerCell=cell;
      route=routeAction(me,center,obstacles);
    }
    const hasRoute=Boolean(goal&&d2(me,goal)>8**2);
    if(oldPose?.navigating&&hasRoute) {
      const idle=d2(oldPose,me)<0.15;
      const rotating=Math.abs(wrap(me.angle-oldPose.angle))>0.02;
      const reversal=route.turn&&Math.sign(oldPose.turn)===-Math.sign(route.turn);
      if(idle&&(oldPose.throttle||!rotating||reversal)) stuck++;
      else stuck=Math.max(0,stuck-1);
    } else stuck=0;
    if(stuck>=7&&!escape) {
      steer=-steer;escape={action:recover(me,goal,obstacles,nearbyEnemies,steer),until:tick+10};
      waypoint=null;cornerCell=-1;stuck=0;navUntil=tick+17;aimStarted=null;lockAim=null;
    }
    let preferred=route,navigating=hasRoute;
    const weapon=me.weapon;
    const shotSpeed=weapon==='frag'?4.5:weapon==='gatling'?7.5:obs.shellSpeed??6;
    const ready=weapon?!(weapon==='gatling'&&me.weaponGap>0):armed&&(me.cooldown??0)<=1;
    const canUse=ready&&weapon!=='mine'&&!(weapon==='frag'&&me.fragId);
    if(!zonePressure&&canUse&&nearbyEnemies.length&&tick>=navUntil) {
      const beam=weapon==='laser'||weapon==='death-ray';
      const press=weapon==='laser'||weapon==='frag';
      const canPress=!press||!me.fireHeld;
      const directRange=beam?576:58;
      const currentShot=shot(me,me.angle,nearbyEnemies,map.walls,weapon,beam?1:shotSpeed,directRange);
      const immediatelyUseful=currentShot&&currentShot.hit!==me.id&&currentShot.travel<=12;
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
        if(!lockAim||tick-lockAim.tick>=4) {
          const plan=aimPlan(me,nearbyEnemies,map.walls,weapon,shotSpeed,tick);
          lockAim=plan?{...plan,tick}:null;
        }
        if(lockAim) {
          const err=wrap(lockAim.angle-me.angle);
          if(Math.abs(err)<0.8||(weapon&&weapon!=='gatling')) {
            aimStarted??=tick;
            if(tick-aimStarted>=13) {
              navUntil=tick+11;lockAim=null;aimStarted=null;
            } else {
              preferred={throttle:0,turn:Math.abs(err)>0.03?Math.sign(err):0,fire:false};
              navigating=false;
              if(Math.abs(err)<0.12) {
                const h=shot(me,me.angle+preferred.turn*TURN,nearbyEnemies,map.walls,weapon,beam?1:shotSpeed,directRange);
                preferred.fire=Boolean(h&&h.hit!==me.id&&canPress);
              }
            }
          }
        } else aimStarted=null;
      }
    } else {lockAim=null;aimStarted=null;}
    if(!zonePressure&&weapon==='death-ray'&&me.weaponCharge>0&&enemies.length) {preferred={...neutral(),fire:true};navigating=false;}
    if(!zonePressure&&weapon==='frag'&&me.fragId&&!me.fireHeld) {
      const bomb=obs.bullets.find(b=>b.id===me.fragId);
      if(bomb&&d2(me,bomb)>75**2&&enemies.some(e=>d2(e,bomb)<70**2)) preferred.fire=true;
    }
    if(!zonePressure&&weapon==='mine'&&!me.fireHeld&&enemies[0]&&d2(me,enemies[0])<110**2&&
      Math.abs(wrap(heading(me,enemies[0])-me.angle))>2.0) preferred.fire=true;
    if(escape&&tick>=escape.until) escape=null;
    if(escape) {preferred=escape.action;navigating=false;}
    const mineThreat=(obs.mines??[]).filter(m=>d2(me,m)<65**2);
    const projectiles=hazardTrack(me,obs.bullets,map.walls);
    if(projectiles.length||mineThreat.length) {
      const before=safety(me,preferred,obstacles,projectiles,mineThreat,nearbyEnemies,tick);
      if(before.risk>2.5) {
        const base={x:before.x,y:before.y};
        let best=before.risk, candidate=preferred;
        for(const model of MOVES) {
          const run=safety(me,model,obstacles,projectiles,mineThreat,nearbyEnemies,tick);
          const cost=run.risk+Math.sqrt(d2(run,base))*0.013+0.15;
          if(cost<best){best=cost;candidate=model;}
        }
        if(candidate!==preferred) navigating=false;
        preferred={...candidate};
      }
    }
    oldPose={x:me.x,y:me.y,angle:me.angle,throttle:preferred.throttle,turn:preferred.turn,navigating};
    return preferred;
  };
}
