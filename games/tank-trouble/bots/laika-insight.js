// Independent Tank Trouble tactic for the privileged Laika seat. Does not change the base bot.
import {traceLaser} from '../engine/laser-geometry.js';

export const LAIKA_INSIGHT_POLICY='laika-insight/5';

const TANK_RADIUS=12, SHELL_RADIUS=3;
const EPS=1e-7;
const d2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const cross=(ax,ay,bx,by)=>ax*by-ay*bx;
const validAction=a=>a&&[-1,0,1].includes(a.throttle)&&[-1,0,1].includes(a.turn)&&typeof a.fire==='boolean';
const teamMate=(obs,a,b)=>obs.teams?.[a.id]!==undefined&&obs.teams[a.id]===obs.teams[b.id];
const hullLocked=(t,obs)=>t.weapon==='remote'&&t.fragId!=null ||
  t.weapon==='laser'&&t.fragId!=null || t.weapon==='death-ray'&&t.weaponCharge>0&&
  (t.beamUntil===undefined||t.beamUntil+(obs.profile.deathRayFade??0)>(obs.roundTick??obs.tick));

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

function laserPath(obs,start,range) {
  if(![obs.width,obs.height,obs.profile.laserSpeed,range].every(n=>Number.isFinite(n)&&n>0)) return null;
  return traceLaser(obs,{...start,heading:start.heading??Math.atan2(start.vy,start.vx)},range).path;
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
    const range=(b.kind==='laser'?obs.profile.laserSpeed:speed)*horizon;
    if(closest>(range+radius)**2) return false;
    if(b.kind==='laser') {
      const path=laserPath(obs,b,range);
      return !path||path.some((end,i)=>i>0&&Math.min(segmentDistance2(me,path[i-1],end),
        segmentDistance2(p,path[i-1],end))<radius**2);
    }
    const to={x:b.x+b.vx*horizon,y:b.y+b.vy*horizon};
    if(blockedByWall(b,to,obs.walls,SHELL_RADIUS)) return true;
    if(b.owner===me.id&&!b.ownerArmed) return false;
    return Math.min(segmentDistance2(me,b,to),segmentDistance2(p,b,to))<radius**2;
  });
}

// A forecast is a possible spawn, not a reservation. Stage outside the
// referee's 30px exclusion radius, only through an immediately clear route.
function stageForPickup(message,base,me,obs) {
  const forecast=message.pickupForecast,crate=forecast?.candidate;
  const rate=obs.profile.tickRate,cell=64;
  if(!crate||!Number.isInteger(obs.roundTick)||!Number.isInteger(forecast.ticksUntil)||
     forecast.attemptTick!==obs.roundTick+forecast.ticksUntil||
     forecast.ticksUntil<1||forecast.ticksUntil>2*rate||
     ![crate.x,crate.y,obs.width,obs.height].every(Number.isFinite)||
     crate.x<=0||crate.x>=obs.width||crate.y<=0||crate.y>=obs.height||
     me.weapon||base.fire||base.throttle<0||base.turn&&!base.throttle) return base;
  const cells=Math.abs(Math.floor(me.x/cell)-Math.floor(crate.x/cell))+
    Math.abs(Math.floor(me.y/cell)-Math.floor(crate.y/cell));
  const distance2=d2(me,crate);
  if(cells>1||distance2<30**2||distance2>92**2||
     (obs.pickups??[]).some(p=>d2(me,p)<92**2)) return base;
  const others=obs.tanks.filter(t=>t.alive&&t!==me);
  if(others.some(t=>!teamMate(obs,me,t)&&d2(me,t)<88**2)) return base;

  const direction=Math.atan2(me.y-crate.y,me.x-crate.x);
  const stage=[direction,...Array.from({length:8},(_,i)=>i*Math.PI/4)]
    .map(a=>({x:crate.x+34*Math.cos(a),y:crate.y+34*Math.sin(a)}))
    .filter(p=>p.x>=TANK_RADIUS&&p.x<=obs.width-TANK_RADIUS&&p.y>=TANK_RADIUS&&p.y<=obs.height-TANK_RADIUS&&
      !blockedByWall(me,p,obs.walls,TANK_RADIUS))
    .sort((a,b)=>d2(me,a)-d2(me,b))[0];
  if(!stage||!safeToRecover(obs,me,me)) return base;
  const neutral={turn:0,throttle:0,fire:false};
  if(d2(me,stage)<=4**2) {
    const currentPlan=pose(me,base,obs);
    return forecast.ticksUntil<=rate*0.4||d2(currentPlan,crate)<30**2?neutral:base;
  }
  // Predict the next pose so no steering step drives through the exclusion
  // radius or another tank.
  const targetAngle=Math.atan2(stage.y-me.y,stage.x-me.x);
  const angleError=Math.atan2(Math.sin(targetAngle-me.angle),Math.cos(targetAngle-me.angle));
  const turn=Math.abs(angleError)>obs.profile.turnSpeed/2?Math.sign(angleError):0;
  const errorAfter=angleError-turn*obs.profile.turnSpeed;
  const action={turn,throttle:Math.abs(errorAfter)<0.45?1:0,fire:false};
  const next=pose(me,action,obs);
  const padding=2*TANK_RADIUS+obs.profile.forwardSpeed;
  if(d2(next,crate)<30**2||others.some(t=>d2(next,t)<padding**2)||
     !safeToRecover(obs,me,next)) return base;
  if(action.throttle&&d2(next,stage)>=d2(me,stage)) return base;
  return action;
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
  function apply(message,base) {
    const obs=message.observation;
    const me=obs?.tanks?.find(t=>t.id===obs.playerId&&t.alive);
    if(!me||obs.phase!=='playing'||obs.result||hullLocked(me,obs)||!validAction(base)||
       !Array.isArray(obs.walls)||!Array.isArray(obs.bullets)||!['tickRate','forwardSpeed','reverseSpeed','turnSpeed']
        .every(k=>Number.isFinite(obs.profile?.[k])&&obs.profile[k]>0)) {reset();return base;}
    if(prior&&(prior.round!==obs.round||prior.tick!==message.tick-1)) reset();
    const distance2=prior?d2(prior.me,me):Infinity;
    if(distance2<0.1**2&&prior.wallBlocked) blocked++;
    else if(distance2<4**2) blocked=Math.max(0,blocked-2);
    else blocked=0;
    if(exit&&(message.tick>=exit.until||d2(exit.origin,me)>=12**2)) exit=null;
    if(!exit&&base.throttle&&blocked>=Math.max(3,Math.ceil(obs.profile.tickRate*0.1))) {
      exit={origin:me,until:message.tick+Math.ceil(obs.profile.tickRate*0.3)};
    }
    if(exit&&!base.throttle) exit=null;
    const mayRecover=!base.fire&&safeToRecover(obs,me,me);
    const wasRecovering=exit!==null;
    let action=exit&&mayRecover?(choose(me,obs)??base):base;
    if(exit&&mayRecover&&action===base) exit=null;
    if(!wasRecovering&&message.pickupForecast) action=stageForPickup(message,base,me,obs);
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
      const {pickupForecast,...ordinaryMessage}=message;
      // Reserve a small margin for the synchronous overlay. If a deadline is
      // already too close, still give the base process its ordinary decision.
      const hasBudget=Number.isFinite(budget)&&budget>2;
      const response=await seat.act(ordinaryMessage,hasBudget?budget-1:budget);
      if(!response||response.error||Number.isFinite(budget)&&performance.now()-began>=budget) {
        recovery.reset();
        return response;
      }
      const value=recovery.apply(message,response.value);
      if(Number.isFinite(budget)&&performance.now()-began>=budget) {
        recovery.reset();
        return response;
      }
      return value===response.value?response:{...response,value};
    },
    close() { return seat.close?.(); }
  };
}
