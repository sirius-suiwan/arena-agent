// Independent Tank Trouble tactic for the privileged Laika seat. Does not change the base bot.
export const LAIKA_INSIGHT_POLICY='laika-insight/1';

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

function ordinaryAmmo(obs,t) {
  return obs.bullets.filter(b=>b.kind==='shell'&&b.owner===t.id).length<obs.profile.shellLimit;
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
  if(!commands||!Number.isInteger(message.tick)||message.tick<=0||message.opponentActionsTick!==message.tick-1||
     !obs||obs.phase!=='playing'||obs.roundTick===0||obs.result||!validAction(base)||
     !Array.isArray(obs.tanks)||!Array.isArray(obs.walls)||!Array.isArray(obs.bullets)||
     !['tickRate','turnSpeed','forwardSpeed','reverseSpeed','shellSpeed','shellLimit']
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
  if(me.weapon||me.fireHeld||!ordinaryAmmo(obs,me)) return base;
  const targets=others.filter(t=>!teamMate(obs,me,t)&&!t.invulnerable);
  // One possible continuation of last tick's movement, then a short direct
  // firing line. The opponent's next movement and fire are not known.
  const range=p.shellSpeed*p.tickRate*0.5;
  const canHit=(from,target)=>directHit(from,target,range,SHELL_RADIUS,obs.walls,blockers);
  const hit=targets.some(t=>canHit(mine,predicted.get(t.id)));
  if(base.fire&&hit) return base;
  // A previous movement may continue across the line. Keep the original
  // throttle and only add a shot when the forecast changes the decision.
  for(const turn of [base.turn,0,-1,1]) {
    const candidate={...base,turn,fire:true},point=pose(me,candidate,obs);
    if(couldCollide(point,others,predicted,collisionPadding)||!safeToChangeAim(obs,me,point)) continue;
    if(targets.some(t=>known.get(t.id)?.throttle&&canHit(point,predicted.get(t.id))&&
      !directHit(point,t,range,SHELL_RADIUS,obs.walls,others))) return candidate;
  }
  // Release only when a target previously in a clear firing line would
  // leave it on continued movement, not just because another tank might block.
  if(base.fire&&targets.some(t=>known.get(t.id)?.throttle&&
    directHit(mine,t,range,SHELL_RADIUS,obs.walls,others)&&
    !directHit(mine,predicted.get(t.id),range,SHELL_RADIUS,obs.walls,[]))) {
    return {...base,fire:false};
  }
  return base;
}

export function withLaikaInsight(seat) {
  return {
    start(message) { return seat.start?.(message); },
    async act(message,budget) {
      const began=performance.now();
      const {opponentActions,opponentActionsTick,...ordinaryMessage}=message;
      // Reserve a small margin for the synchronous overlay. If a deadline is
      // already too close, still give the base process its ordinary decision.
      const hasBudget=Number.isFinite(budget)&&budget>2;
      const hasHistory=opponentActions!==undefined&&opponentActionsTick===message.tick-1;
      const response=await seat.act(ordinaryMessage,hasBudget&&hasHistory?budget-1:budget);
      if(!response||response.error||!hasHistory||
         Number.isFinite(budget)&&performance.now()-began>=budget) return response;
      const value=insight(message,response.value);
      return value===response.value||Number.isFinite(budget)&&performance.now()-began>=budget?response:{...response,value};
    },
    close() { return seat.close?.(); }
  };
}
