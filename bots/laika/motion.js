// Local movement prediction, independently implemented for Arena's reflective
// maze. Conceptual reference: Robocode's precise movement/wall smoothing.
const EPS=1e-7, HULL=12;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const sq=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const commands=[[1,0],[-1,0],[1,-1],[1,1],[-1,-1],[-1,1],[0,-1],[0,1],[0,0]];
const next=(p,m,physics)=>{
  const angle=p.angle+m.turn*physics.turn, distance=m.throttle*(m.throttle<0?physics.b:physics.f);
  return {angle,x:p.x+Math.cos(angle)*distance,y:p.y+Math.sin(angle)*distance};
};
export function legalPose(p,walls) {
  return !walls.some(w=>(p.x-clamp(p.x,w.x1,w.x2))**2+(p.y-clamp(p.y,w.y1,w.y2))**2<HULL**2);
}
const wallsNear=(walls,p,r)=>walls.filter(w=>w.x1<=p.x+r&&w.x2>=p.x-r&&w.y1<=p.y+r&&w.y2>=p.y-r);

function wallContact(x,y,dx,dy,walls,r) {
  let best=null;
  const consider=(f,nx,ny)=>{
    if(f<-EPS||f>1+EPS||dx*nx+dy*ny>=-EPS) return;
    f=clamp(f,0,1);
    if(!best||f<best.f-EPS) best={f,nx,ny,corner:false};
    else if(Math.abs(f-best.f)<=EPS&&Math.abs(nx*best.ny-ny*best.nx)>EPS) best.corner=true;
  };
  const a=dx*dx+dy*dy;
  if(a<EPS) return null;
  for(const w of walls) {
    if(w.x1===w.x2&&Math.abs(dx)>EPS) {
      const nx=-Math.sign(dx),f=(w.x1+nx*r-x)/dx,along=y+dy*f;
      if(along>=w.y1-EPS&&along<=w.y2+EPS) consider(f,nx,0);
    } else if(w.y1===w.y2&&Math.abs(dy)>EPS) {
      const ny=-Math.sign(dy),f=(w.y1+ny*r-y)/dy,along=x+dx*f;
      if(along>=w.x1-EPS&&along<=w.x2+EPS) consider(f,0,ny);
    }
    if(r===0) continue;
    for(let i=0;i<2;i++) {
      const ox=x-(i?w.x2:w.x1),oy=y-(i?w.y2:w.y1);
      const b=ox*dx+oy*dy,c=ox*ox+oy*oy-r*r,disc=b*b-a*c;
      if(b>=-EPS||disc<=0) continue;
      const f=c<=EPS?0:(-b-Math.sqrt(disc))/a;
      const nx=ox+f*dx,ny=oy+f*dy,l=Math.hypot(nx,ny);
      if(l>EPS) consider(f,nx/l,ny/l);
    }
  }
  return best;
}

export function clearDrive(me,to,walls) {
  return !wallContact(me.x,me.y,to.x-me.x,to.y-me.y,walls,HULL);
}

function distanceToPath2(p,x,y,u,v) {
  const dx=u-x,dy=v-y,l=dx*dx+dy*dy;
  const f=l>EPS?clamp(((p.x-x)*dx+(p.y-y)*dy)/l,0,1):0;
  return (p.x-x-dx*f)**2+(p.y-y-dy*f)**2;
}

function sampleLaser(b,n,rows,obs,me,travel) {
  const {profile,width,height}=obs;
  let x=b.x,y=b.y,heading=b.heading??Math.atan2(b.vy,b.vx),curved=Boolean(b.curved);
  const speed=profile.laserSpeed,bend=profile.laserBendPerTick??0;
  const walls=wallsNear(obs.walls,b,speed*n).filter(w=>w.x1!==w.x2?w.y1>0&&w.y1<height:w.x1>0&&w.x1<width);
  const segment=Math.max(8,profile.laserMaxSegment??12);
  let armed=b.owner!==me.id||b.ownerArmed===true;
  for(let t=0;t<n;t++) {
    let left=speed;
    for(let i=0;i<20&&left>EPS;i++) {
      const length=Math.min(segment,left),angle=curved?bend*length/speed:0;
      const chord=angle?length*Math.sin(angle/2)/(angle/2):length;
      const dx=chord*Math.cos(heading+angle/2),dy=chord*Math.sin(heading+angle/2);
      const edge=clamp(Math.min(dx>EPS?(width-x)/dx:dx<-EPS?-x/dx:Infinity,
        dy>EPS?(height-y)/dy:dy<-EPS?-y/dy:Infinity),0,1);
      let cross=Infinity;
      if(!curved) for(const w of walls) {
        const v=w.x1===w.x2,d=v?dx:dy;
        if(Math.abs(d)<EPS) continue;
        const f=(v?w.x1-x:w.y1-y)/d,along=v?y+f*dy:x+f*dx;
        if(f>EPS&&f<=1&&along>=(v?w.y1:w.x1)-EPS&&along<=(v?w.y2:w.x2)+EPS) cross=Math.min(f,cross);
      }
      const f=Math.min(edge,cross),u=x+dx*f,v=y+dy*f;
      if(armed&&distanceToPath2(me,x,y,u,v)<travel**2) rows[t].push([x,y,u,v,HULL]);
      x=u;y=v;heading+=angle*f;
      if(sq(me,{x,y})>HULL**2) armed=true;
      if(edge<1&&edge<=cross) return;
      if(cross<=edge) {curved=true;left-=f*length;} else left-=length;
    }
  }
}

function forecast(me,obs,physics,horizon) {
  const rows=Array.from({length:horizon},()=>[]);
  const travel=physics.f*horizon+HULL+8;
  const friendly=id=>!obs.friendlyFire&&obs.teams?.[me.id]!==undefined&&id!==me.id&&obs.teams[id]===obs.teams[me.id];
  const candidates=[];
  for(const b of obs.bullets) {
    if(friendly(b.owner)||![b.x,b.y,b.vx,b.vy].every(Number.isFinite)) continue;
    const speed=Math.hypot(b.vx,b.vy);
    const ticks=Math.max(0,Math.min(horizon,b.ttl??horizon));
    const bound=(Math.sqrt(sq(me,b))-travel)/speed;
    if(speed>EPS&&ticks>0&&bound<ticks) candidates.push({b,speed,ticks,bound});
  }
  candidates.sort((a,b)=>a.bound-b.bound);
  for(const {b,speed,ticks} of candidates.slice(0,20)) {
    if(b.kind==='laser') {sampleLaser(b,ticks,rows,obs,me,travel);continue;}
    const r=b.kind==='gatling'?(obs.profile.gatlingRadius??3)
      :b.kind==='shrapnel'?(obs.profile.fragmentRadius??3):3;
    const walls=wallsNear(obs.walls,b,speed*ticks+r);
    let {x,y,vx,vy}=b,armed=b.owner!==me.id||b.ownerArmed===true;
    for(let t=0;t<ticks;t++) {
      let left=Math.min(1,ticks-t),stopped=false;
      for(let k=0;k<4&&left>EPS;k++) {
        const dx=vx*left,dy=vy*left,w=wallContact(x,y,dx,dy,walls,r);
        const f=w?.f??1,u=x+dx*f,v=y+dy*f;
        if(t>=Math.ceil(b.safeTicks??0)&&armed&&distanceToPath2(me,x,y,u,v)<travel**2) rows[t].push([x,y,u,v,HULL+r]);
        x=u;y=v;
        if(!w) {if(sq(me,{x,y})>(HULL+r)**2) armed=true;break;}
        if(b.kind==='shrapnel') {stopped=true;break;}
        if(w.corner) {vx=-vx;vy=-vy;}
        else if(b.kind==='shell'||b.kind==='gatling') {
          if(Math.abs(w.nx)>EPS) vx=-vx;
          if(Math.abs(w.ny)>EPS) vy=-vy;
        } else {
          const dot=vx*w.nx+vy*w.ny;
          vx-=2*dot*w.nx;vy-=2*dot*w.ny;
        }
        x+=vx*EPS;y+=vy*EPS;armed=true;left*=1-f;
      }
      if(stopped) break;
    }
  }
  for(const t of obs.tanks) {
    if(t.id===me.id||!t.alive||friendly(t.id)||t.weapon!=='death-ray'||sq(t,me)<EPS) continue;
    const now=obs.roundTick??obs.tick;
    const start=t.beamUntil>now?0:
      t.weaponCharge>0&&t.beamUntil===undefined?Math.max(0,(obs.profile.deathRayCharge??Infinity)-t.weaponCharge-1):Infinity;
    if(start>=horizon) continue;
    const reach=Math.hypot(obs.width,obs.height),u=t.x+Math.cos(t.angle)*reach,v=t.y+Math.sin(t.angle)*reach;
    if(distanceToPath2(me,t.x,t.y,u,v)>=travel**2) continue;
    const end=t.beamUntil>now?Math.min(horizon,t.beamUntil-now):horizon;
    for(let i=start;i<end;i++) rows[i].push([t.x,t.y,u,v,HULL]);
  }
  return rows;
}

export function dodgeMotion(me,obs,action,physics) {
  if(me.invulnerable) return action;
  const horizon=physics.ticks(22);
  const samples=forecast(me,obs,physics,horizon);
  if(samples.every(row=>!row.length)) return action;
  const walls=wallsNear(obs.walls,me,physics.f*horizon+HULL);
  const others=obs.tanks.filter(t=>t.id!==me.id&&t.alive&&sq(me,t)<(physics.f*horizon+2*HULL)**2);
  const hold=physics.ticks(10);
  const outside=p=>{
    const z=obs.zone;
    return z?Math.max(0,Math.abs(p.x-z.x)-z.halfWidth,Math.abs(p.y-z.y)-z.halfHeight):0;
  };
  const outsideNow=outside(me);
  function measure(first,after) {
    let p=me,hit=Infinity,close=0,blocks=0;
    for(let i=0;i<horizon;i++) {
      const move=i<hold?first:after;
      const q=next(p,move,physics);
      if(move.throttle&&(!legalPose(q,walls)||others.some(t=>sq(t,q)<(2*HULL)**2))) {
        p={...p,angle:q.angle};blocks++;
      } else p=q;
      for(const [x,y,u,v,r] of samples[i]) {
        const d2=distanceToPath2(p,x,y,u,v);
        if(d2<r*r) hit=Math.min(hit,i);
        if(d2<(r+5)**2) close+=((r+5)**2-d2)/((r+5)**2*(i+4));
      }
    }
    return {hit,cost:close+blocks*0.012+Math.max(0,outside(p)-outsideNow)*0.01};
  }
  const steady={throttle:action.throttle,turn:0};
  const stop={throttle:0,turn:0};
  const regular=measure(action,steady);
  // Don't interrupt combat for something just passing by.
  if(regular.hit===Infinity) return action;
  let best=regular,pick=action;
  for(const [throttle,turn] of commands) {
    const dodge={throttle,turn,fire:false};
    const followUps=throttle?[stop,{throttle,turn:0}]:turn?[{throttle:1,turn:0},{throttle:-1,turn:0}]:[stop];
    for(const after of followUps) {
      const score=measure(dodge,after);
      if(score.hit>best.hit||score.hit===best.hit&&score.cost+0.03<best.cost) {best=score;pick=dodge;}
    }
  }
  return pick;
}

export function escapeMotion(me,goal,obs,physics,preferredTurn=0) {
  const horizon=physics.ticks(14),walls=wallsNear(obs.walls,me,physics.f*horizon+HULL);
  const others=obs.tanks.filter(t=>t.id!==me.id&&t.alive);
  let best=null;
  for(const [throttle,turn] of commands) {
    if(!throttle) continue;
    let p=me,blocked=0,moved=false;
    const first=next(me,{throttle,turn},physics);
    const safe=q=>legalPose(q,walls)&&!others.some(t=>sq(t,q)<(2*HULL)**2);
    const canStart=safe(first);
    if(!canStart&&!turn) continue;
    for(let i=0;i<horizon;i++) {
      const q=next(p,{throttle,turn:i<Math.ceil(horizon/2)?turn:0},physics);
      if(safe(q)) {p=q;moved=true;}
      else {p={...p,angle:q.angle};blocked++;}
    }
    if(!moved) continue;
    const gain=Math.sqrt(sq(me,goal))-Math.sqrt(sq(p,goal));
    const score=gain-blocked*0.45-Math.abs(turn)*0.04+(turn&&turn===preferredTurn?1:0);
    if(!best||score>best.score) best={score,action:{throttle:canStart?throttle:0,turn,fire:false}};
  }
  return best?.action??{throttle:0,turn:0,fire:false};
}
