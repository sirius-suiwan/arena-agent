// Independent Tank Trouble tactic for the privileged Laika seat. Does not change the base bot.
export const LAIKA_INSIGHT_POLICY='laika-insight/3';

const TANK_RADIUS=12, SHELL_RADIUS=3;
const EPS=1e-7;
const d2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const cross=(ax,ay,bx,by)=>ax*by-ay*bx;
const validAction=a=>a&&[-1,0,1].includes(a.throttle)&&[-1,0,1].includes(a.turn)&&typeof a.fire==='boolean';
const teamMate=(obs,a,b)=>obs.teams?.[a.id]!==undefined&&obs.teams[a.id]===obs.teams[b.id];
const hullLocked=(t,obs)=>t.weapon==='remote'&&t.fragId!=null ||
  t.weapon==='death-ray'&&(t.weaponCharge>0&&t.beamUntil===undefined||t.beamUntil>(obs.roundTick??obs.tick));

function segmentDistance2(p,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
  const f=len?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)):0;
  return d2(p,{x:a.x+dx*f,y:a.y+dy*f});
}

function blockedByWall(start,end,walls,radius) {
  const dx=end.x-start.x,dy=end.y-start.y;
  return walls.some(w=>{
    const a={x:w.x1,y:w.y1},b={x:w.x2,y:w.y2},wx=b.x-a.x,wy=b.y-a.y;
    const det=cross(dx,dy,wx,wy);
    if(Math.abs(det)>EPS) {
      const sx=a.x-start.x,sy=a.y-start.y;
      const t=cross(sx,sy,wx,wy)/det,u=cross(sx,sy,dx,dy)/det;
      if(t>=0&&t<=1&&u>=0&&u<=1) return true;
    }
    return radius>0&&Math.min(segmentDistance2(start,a,b),segmentDistance2(end,a,b),
      segmentDistance2(a,start,end),segmentDistance2(b,start,end))<=radius**2;
  });
}

function pose(t,a,obs) {
  if (!a||hullLocked(t,obs)) return t;
  const {turnSpeed,forwardSpeed,reverseSpeed}=obs.profile;
  const angle=t.angle+a.turn*turnSpeed;
  const distance=a.throttle*(a.throttle<0?reverseSpeed:forwardSpeed);
  const p={...t,angle,x:t.x+Math.cos(angle)*distance,y:t.y+Math.sin(angle)*distance};
  if(obs.walls.some(w=>segmentDistance2(p,{x:w.x1,y:w.y1},{x:w.x2,y:w.y2})<TANK_RADIUS**2)) {
    p.x=t.x;p.y=t.y;
  }
  return p;
}

function couldCollide(p,others,predicted,padding=0) {
  const radius2=(2*TANK_RADIUS+padding)**2;
  return others.some(t=>d2(p,t)<radius2||d2(p,predicted.get(t.id))<radius2);
}

// Only clear direct shots are considered: no ricochet or opponent-motion guess past this tick.
function directHit(from,to,limit,radius,walls,blockers) {
  const dx=Math.cos(from.angle),dy=Math.sin(from.angle),rx=to.x-from.x,ry=to.y-from.y;
  const front=rx*dx+ry*dy,side2=(rx*dy-ry*dx)**2,extent=TANK_RADIUS+radius;
  if(front<=0||side2>=extent**2) return false;
  const touch=Math.max(0,front-Math.sqrt(extent**2-side2));
  if(touch>limit) return false;
  const end={x:from.x+dx*touch,y:from.y+dy*touch};
  return !blockedByWall(from,end,walls,radius)&&!blockers.some(t=>
    t.id!==from.id&&t.id!==to.id&&!t.invulnerable&&segmentDistance2(t,from,end)<extent**2);
}

function safeToChangeAim(obs,t,p) {
  const zone=obs.zone;
  const outside=q=>zone?Math.max(0,Math.abs(q.x-zone.x)-zone.halfWidth,Math.abs(q.y-zone.y)-zone.halfHeight):0;
  if(outside(p)>outside(t)) return false;
  // Leave evasive decisions to the base bot around other uncertain hazards.
  if((obs.mines??[]).some(m=>Math.min(d2(t,m),d2(p,m))<45**2)) return false;
  return !obs.bullets.some(b=>Math.min(d2(t,b),d2(p,b))<(26+Math.hypot(b.vx,b.vy))**2);
}

function insight(message,base) {
  const obs=message.observation,commands=message.opponentActions;
  if(!commands||!Number.isInteger(message.tick)||message.tick<0||message.opponentActionsTick!==message.tick||
     !obs||obs.phase!=='playing'||obs.result||!validAction(base)||
     !Array.isArray(obs.tanks)||!Array.isArray(obs.walls)||!Array.isArray(obs.bullets)||
     !['tickRate','turnSpeed','forwardSpeed','reverseSpeed','shellSpeed','shellLimit','laserSpeed']
       .every(k=>Number.isFinite(obs.profile?.[k])&&obs.profile[k]>0)) return base;
  const me=obs.tanks.find(t=>t.id===obs.playerId&&t.alive);
  if(!me||hullLocked(me,obs)) return base;
  const others=obs.tanks.filter(t=>t.alive&&t!==me);
  const known=new Map(others.filter(t=>Object.hasOwn(commands,t.id)&&validAction(commands[t.id]))
    .map(t=>[t.id,commands[t.id]]));
  if(!known.size) return base;
  const predicted=new Map(others.map(t=>[t.id,pose(t,known.get(t.id),obs)]));
  const collisionPadding=Math.max(obs.profile.forwardSpeed,obs.profile.reverseSpeed);
  if(couldCollide(pose(me,base,obs),others,predicted,collisionPadding)||
     others.some(t=>known.has(t.id)&&couldCollide(predicted.get(t.id),others.filter(o=>o!==t),predicted,collisionPadding))) return base;
  const blockers=[...predicted.values()];
  const p=obs.profile;
  const mine=pose(me,base,obs);
  const shellsByOwner=new Map();
  for(const b of obs.bullets) if(b.kind==='shell') shellsByOwner.set(b.owner,(shellsByOwner.get(b.owner)??0)+1);
  const ordinaryAmmo=t=>(shellsByOwner.get(t.id)??0)<p.shellLimit;
  // Honor fresh presses only. Automatic/special trajectories are left to the
  // base bot unless they are the immediate and predictable direct laser.
  const threats=me.invulnerable?[]:others.flatMap(t=>{
    if(!known.get(t.id)?.fire||t.fireHeld||(teamMate(obs,t,me)&&!obs.friendlyFire)) return [];
    const from=predicted.get(t.id);
    const isLaser=t.weapon==='laser';
    if(!isLaser&&(t.weapon||!ordinaryAmmo(t))) return [];
    return [{from,limit:isLaser?p.laserSpeed:p.shellSpeed*p.tickRate*0.22,radius:isLaser?0:SHELL_RADIUS,
      blockers:obs.friendlyFire?blockers:blockers.filter(other=>!teamMate(obs,t,other))}];
  });
  const risk=point=>threats.reduce((n,s)=>n+Number(directHit(s.from,point,s.limit,s.radius,obs.walls,s.blockers)),0);
  const danger=risk(mine);
  if(danger) {
    const choices=[];
    for(const throttle of new Set([base.throttle,0,-1,1])) for(const turn of new Set([base.turn,0,-1,1])) {
      const point=pose(me,{throttle,turn},obs);
      if(couldCollide(point,others,predicted,collisionPadding)||!safeToChangeAim(obs,me,point)) continue;
      const remaining=risk(point);
      if(remaining<danger) choices.push({throttle,turn,remaining,
        cost:Number(throttle!==base.throttle)+Number(turn!==base.turn)+0.1*Math.abs(throttle-base.throttle)});
    }
    choices.sort((a,b)=>a.remaining-b.remaining||a.cost-b.cost);
    if(!choices.length) return base;
    const {throttle,turn}=choices[0];
    return {throttle,turn,fire:false};
  }
  if(me.weapon||me.fireHeld||!ordinaryAmmo(me)) return base;
  const targets=others.filter(t=>!teamMate(obs,me,t)&&!t.invulnerable);
  // Enemy movement this tick is accepted, but behavior in later ticks is not
  // known. Consider a short direct line, never speculative ricochets.
  const range=p.shellSpeed*p.tickRate*0.5;
  const canHit=(from,target)=>directHit(from,target,range,SHELL_RADIUS,obs.walls,blockers);
  const hit=targets.some(t=>canHit(mine,predicted.get(t.id)));
  if(base.fire&&hit) return base;
  // Keep the original throttle. Add a shot for newly exposed targets or a
  // very short clear line at the accepted pose, not a distant stationary guess.
  for(const turn of new Set([base.turn,0,-1,1])) {
    const candidate={...base,turn,fire:true},point=pose(me,candidate,obs);
    if(couldCollide(point,others,predicted,collisionPadding)||!safeToChangeAim(obs,me,point)||risk(point)) continue;
    if(targets.some(t=>known.has(t.id)&&(
      directHit(point,predicted.get(t.id),p.shellSpeed*p.tickRate*0.16,SHELL_RADIUS,obs.walls,blockers)||
      known.get(t.id).throttle&&canHit(point,predicted.get(t.id))&&
      !directHit(point,t,range,SHELL_RADIUS,obs.walls,others)))) return candidate;
  }
  // Release only when the accepted movement takes a previously clear target
  // out of the line, not just because another tank may block it.
  if(base.fire&&targets.some(t=>known.get(t.id)?.throttle&&
    directHit(mine,t,range,SHELL_RADIUS,obs.walls,others)&&
    !directHit(mine,predicted.get(t.id),range,SHELL_RADIUS,obs.walls,[]))) {
    return {...base,fire:false};
  }
  return base;
}

// Recovery cares whether a projectile can intersect its current or proposed
// pose, not whether an unrelated returning shell is merely nearby.
function safeToRecover(obs,me,p) {
  const outside=q=>obs.zone?Math.max(0,Math.abs(q.x-obs.zone.x)-obs.zone.halfWidth,Math.abs(q.y-obs.zone.y)-obs.zone.halfHeight):0;
  if(outside(p)>outside(me)||(obs.mines??[]).some(m=>Math.min(d2(me,m),d2(p,m))<45**2)) return false;
  return !obs.bullets.some(b=>{
    const closest=Math.min(d2(me,b),d2(p,b)),speed=Math.hypot(b.vx,b.vy);
    if(!Number.isFinite(speed)) return closest<30**2;
    const horizon=Math.min(b.ttl??Infinity,Math.max(1,obs.profile.tickRate*0.085));
    const radius=TANK_RADIUS+(b.kind==='laser'?0:SHELL_RADIUS)+2;
    if(closest>(speed*horizon+radius)**2) return false;
    const to={x:b.x+b.vx*horizon,y:b.y+b.vy*horizon};
    if(blockedByWall(b,to,obs.walls,b.kind==='laser'?0:SHELL_RADIUS)) return true;
    if(b.owner===me.id&&!b.ownerArmed) return false;
    return Math.min(segmentDistance2(me,b,to),segmentDistance2(p,b,to))<radius**2;
  });
}

// Detect repeated *attempted* wall-blocked movement without mistaking waiting,
// tank collisions, or a single turn at a corner for a stuck bot.
function makeWallRecovery() {
  let prior=null,blocked=0,exit=null;
  const reset=()=>{prior=null;blocked=0;exit=null;};
  function choose(me,obs) {
    const cell=64;
    const center={x:(Math.floor(me.x/cell)+0.5)*cell,y:(Math.floor(me.y/cell)+0.5)*cell};
    const others=obs.tanks.filter(t=>t.alive&&t!==me);
    const clear=p=>others.every(t=>d2(p,t)>=(2*TANK_RADIUS+obs.profile.forwardSpeed)**2)&&safeToRecover(obs,me,p);
    let best=null,score=0;
    for(const throttle of [-1,1]) for(const turn of [0,-1,1]) {
      const action={throttle,turn,fire:false},p=pose(me,action,obs);
      const progress=d2(me,center)-d2(p,center);
      if(progress>0&&clear(p)&&progress-0.01*Math.abs(turn)>score) {
        best=action;score=progress-0.01*Math.abs(turn);
      }
    }
    if(best) return best;
    // In a shallow corner neither forward nor reverse can move yet: turn in
    // place toward whichever chassis direction can reach the cell centre.
    const heading=Math.atan2(center.y-me.y,center.x-me.x);
    const alignment=a=>Math.abs(Math.cos(heading-a));
    for(const turn of [-1,1]) {
      const improvement=alignment(me.angle+turn*obs.profile.turnSpeed)-alignment(me.angle);
      if(improvement>score) {best={throttle:0,turn,fire:false};score=improvement;}
    }
    return best;
  }
  function apply(message,base,normal) {
    const obs=message.observation;
    const me=obs?.tanks?.find(t=>t.id===obs.playerId&&t.alive);
    if(!me||obs.phase!=='playing'||obs.result||hullLocked(me,obs)||!validAction(base)||
       !Array.isArray(obs.walls)||!Array.isArray(obs.bullets)||!['tickRate','forwardSpeed','reverseSpeed','turnSpeed']
        .every(k=>Number.isFinite(obs.profile?.[k])&&obs.profile[k]>0)) {reset();return normal;}
    if(prior&&(prior.round!==obs.round||prior.tick!==message.tick-1)) reset();
    const distance2=prior?d2(prior.me,me):Infinity;
    const sameTick=message.opponentActionsTick===message.tick;
    const nearbyFire=sameTick&&obs.tanks.some(t=>t.alive&&t!==me&&d2(t,me)<120**2&&
      (!teamMate(obs,t,me)||obs.friendlyFire)&&message.opponentActions?.[t.id]?.fire);
    if(distance2<0.1**2&&prior.wallBlocked) blocked++;
    else if(distance2<4**2) blocked=Math.max(0,blocked-2);
    else blocked=0;
    if(exit&&(message.tick>=exit.until||d2(exit.origin,me)>=12**2)) exit=null;
    if(!exit&&base.throttle&&blocked>=Math.max(3,Math.ceil(obs.profile.tickRate*0.1))) {
      exit={origin:me,until:message.tick+Math.ceil(obs.profile.tickRate*0.3)};
    }
    if(exit&&!base.throttle) exit=null;
    const mayRecover=normal===base&&!base.fire&&!nearbyFire&&safeToRecover(obs,me,me);
    const action=exit&&mayRecover?(choose(me,obs)??normal):normal;
    if(exit&&mayRecover&&action===normal) exit=null;
    const wallBlocked=action.throttle!==0&&d2(pose(me,action,obs),me)<0.1**2;
    prior={me,wallBlocked,tick:message.tick,round:obs.round};
    return action;
  }
  return {apply,reset};
}

export function withLaikaInsight(seat) {
  const recovery=makeWallRecovery();
  return {
    start(message) { recovery.reset();return seat.start?.(message); },
    async act(message,budget) {
      const began=performance.now();
      const {opponentActions,opponentActionsTick,...ordinaryMessage}=message;
      // Reserve a small margin for the synchronous overlay. If a deadline is
      // already too close, still give the base process its ordinary decision.
      const hasBudget=Number.isFinite(budget)&&budget>2;
      const hasInputs=opponentActions!==undefined&&opponentActionsTick===message.tick;
      const response=await seat.act(ordinaryMessage,hasBudget&&hasInputs?budget-1:budget);
      if(!response||response.error||Number.isFinite(budget)&&performance.now()-began>=budget) {
        recovery.reset();
        return response;
      }
      const normal=hasInputs?insight(message,response.value):response.value;
      const value=recovery.apply(message,response.value,normal);
      if(Number.isFinite(budget)&&performance.now()-began>=budget) {
        recovery.reset();
        return response;
      }
      return value===response.value?response:{...response,value};
    },
    close() { return seat.close?.(); }
  };
}
