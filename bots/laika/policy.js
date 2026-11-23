// SPDX-License-Identifier: MIT
// Adapted from Cichlider's Killfield Laika at 0ccc4ab15fa9888687e743574e0258260ee00e77.
// See LICENSE for the original notice and limitations. This is not Sublab's Laika.
const TAU = 2 * Math.PI;
const CELL = 64;
const RADIUS = 12;
const EPS = 1e-5;
const LOOKAHEAD = 16;
const NEUTRAL = { throttle:0,turn:0,fire:false };
const deltaAngle = (target, now) => ((target-now + Math.PI + TAU) % TAU) - Math.PI;
const sqDist = (a,b) => (a.x-b.x)**2 + (a.y-b.y)**2;
const clamp = (x,lo,hi) => Math.min(hi,Math.max(lo,x));
const dirs = [[-1,0],[0,-1],[1,0],[0,1]];
const validProfile=profile=>['tickRate','forwardSpeed','reverseSpeed','turnSpeed',
  'shellLimit','shellSpeed','gatlingSpeed','missileSpeed','laserSpeed','laserTtl','remoteTurn']
  .every(key=>Number.isFinite(profile?.[key])&&profile[key]>0);
function kinetics(profile) {
  const {tickRate,forwardSpeed:f,reverseSpeed:b,turnSpeed:turn}=profile;
  return {f,b,turn,ticks:n=>Math.max(1,Math.round(n*tickRate/60))};
}
const stepDistance=(throttle,physics)=>throttle*(throttle<0?physics.b:physics.f);

function newBoard(obs) {
  const cols=Math.round(obs.width/CELL),rows=Math.round(obs.height/CELL);
  const walls=obs.walls;
  const segments=new Set(walls.map(w=>[w.x1,w.y1,w.x2,w.y2].join(',')));
  const links=Array.from({length:cols*rows},(_,i)=>{
    const x=i%cols,y=Math.floor(i/cols);
    return dirs.flatMap(([dx,dy])=>{
      const nx=x+dx,ny=y+dy;
      if (nx<0||ny<0||nx>=cols||ny>=rows) return [];
      const k=dx===0
        ? [x*CELL,Math.max(y,ny)*CELL,(x+1)*CELL,Math.max(y,ny)*CELL]
        : [Math.max(x,nx)*CELL,y*CELL,Math.max(x,nx)*CELL,(y+1)*CELL];
      return segments.has(k.join(','))?[]:[nx+ny*cols];
    });
  });
  return {walls,links,cols,
    cell:p=>clamp(Math.floor(p.x/CELL),0,cols-1)+clamp(Math.floor(p.y/CELL),0,rows-1)*cols,
    center:i=>({x:(i%cols+0.5)*CELL,y:(Math.floor(i/cols)+0.5)*CELL})};
}

function routes(board,home) {
  const d=new Int16Array(board.links.length).fill(-1);
  const first=new Int16Array(board.links.length).fill(-1);
  const queue=[home]; d[home]=0;
  for (let j=0;j<queue.length;j++) {
    const u=queue[j];
    for (const v of board.links[u]) if (d[v]<0) {
      d[v]=d[u]+1; first[v]=u===home?v:first[u]; queue.push(v);
    }
  }
  return {d,first};
}

function validPose(p,walls) {
  return !walls.some(w=>(p.x-clamp(p.x,w.x1,w.x2))**2+(p.y-clamp(p.y,w.y1,w.y2))**2 < RADIUS**2);
}

// Fast point-ray approximation for choosing shots and predicting danger. It
// shares wall faces with the game but intentionally ignores rounded endpoints.
function wallCross(p,dx,dy,range,walls,radius) {
  let best=range, flipX=false, flipY=false;
  for (const w of walls) {
    let t,vertical=w.x1===w.x2;
    if (vertical) {
      if (Math.abs(dx)<EPS) continue;
      t=(w.x1-Math.sign(dx)*radius-p.x)/dx;
      const y=p.y+dy*t;
      if (y<w.y1-radius||y>w.y2+radius) continue;
    } else {
      if (Math.abs(dy)<EPS) continue;
      t=(w.y1-Math.sign(dy)*radius-p.y)/dy;
      const x=p.x+dx*t;
      if (x<w.x1-radius||x>w.x2+radius) continue;
    }
    if (t<EPS||t>best+EPS) continue;
    if (t<best-EPS) {best=t;flipX=false;flipY=false;}
    if (vertical) flipX=true; else flipY=true;
  }
  return {distance:best,flipX,flipY};
}

function circleCross(p,dx,dy,target,radius) {
  const ox=target.x-p.x,oy=target.y-p.y,project=ox*dx+oy*dy;
  const diff=radius*radius-(ox*ox+oy*oy-project*project);
  if (diff<0||project<0) return Infinity;
  return Math.max(0, project-Math.sqrt(diff));
}

function shotTrace(me,angle,enemies,walls,range,{radius=3,through=false}={}) {
  let p=me,distance=0,dx=Math.cos(angle),dy=Math.sin(angle);
  for(let bounce=0;bounce<=2&&range>0;bounce++) {
    const wall=through?{distance:range}:wallCross(p,dx,dy,range,walls,radius);
    let nearest=Infinity,target=null;
    for(const e of enemies) {
      const t=circleCross(p,dx,dy,e,RADIUS+radius);
      if (t<nearest) {nearest=t;target=e.id;}
    }
    if (bounce) {
      const self=circleCross(p,dx,dy,me,RADIUS+radius);
      if (self<nearest&&self<wall.distance) return {self:true};
    }
    if (target!==null&&nearest<wall.distance) return {target,distance:distance+nearest,bounce};
    p={x:p.x+dx*wall.distance,y:p.y+dy*wall.distance};
    if (!wall.flipX&&!wall.flipY) break;
    if (wall.flipX) dx=-dx;
    if (wall.flipY) dy=-dy;
    p={x:p.x+dx*EPS*2,y:p.y+dy*EPS*2};
    range-=wall.distance;distance+=wall.distance;
  }
  return {};
}

function dangerSamples(me,bullets,walls,physics) {
  const threats=bullets.filter(b=>sqDist(me,b)<162**2&&Number.isFinite(b.vx)&&Number.isFinite(b.vy))
    .sort((a,b)=>sqDist(me,a)-sqDist(me,b)).slice(0,12);
  const horizon=physics.ticks(LOOKAHEAD);
  const samples=Array.from({length:horizon},()=>[]);
  for (const b of threats) {
    let p=b, vx=b.vx,vy=b.vy,armed=b.owner!==me.id||b.ownerArmed===true;
    const speed=Math.hypot(vx,vy);
    if (speed<EPS) continue;
    for (let i=0;i<horizon&&i<(b.ttl??horizon);i++) {
      let dx=vx/speed,dy=vy/speed;
      const radius=b.kind==='laser'?0:3;
      const w=wallCross(p,dx,dy,speed,walls,radius);
      if(w.flipX||w.flipY) {
        if(b.kind==='shrapnel') break;
        p={x:p.x+dx*w.distance,y:p.y+dy*w.distance};
        if(w.flipX) vx=-vx;
        if(w.flipY) vy=-vy;
        dx=vx/speed;dy=vy/speed;
        p={x:p.x+dx*(speed-w.distance+EPS*2),y:p.y+dy*(speed-w.distance+EPS*2)};
        armed=true;
      } else p={x:p.x+vx,y:p.y+vy};
      if (sqDist(p,me)>15**2) armed=true;
      if(armed) samples[i].push(p);
    }
  }
  return samples;
}

function safestMotion(me,walls,samples,goal,physics) {
  let best=null;
  for (const [throttle,turn] of [[1,0],[-1,0],[1,-1],[1,1],[-1,-1],[-1,1],[0,-1],[0,1],[0,0]]) {
    let p=me,heading=me.angle,risk=0;
    for(let i=0;i<samples.length;i++) {
      const reaction=i<physics.ticks(8);
      if (reaction) {
        heading+=physics.turn*turn;
        const step=stepDistance(throttle,physics);
        const q={x:p.x+step*Math.cos(heading),y:p.y+step*Math.sin(heading)};
        if(validPose(q,walls)) p=q;
      }
      for (const b of samples[i]) {
        const d=Math.sqrt(sqDist(p,b));
        risk+=Math.max(0,31-d)/(i+4) + (d<17?4:0);
      }
    }
    const cost=risk+(goal ? Math.sqrt(sqDist(p,goal))*0.0008 : 0) + (throttle===0?0.02:0);
    if (!best||cost<best.cost) best={throttle,turn,cost};
  }
  return best;
}

function drive(me,goal,walls,physics) {
  if (!goal||sqDist(me,goal)<9**2) return {...NEUTRAL};
  const desired=Math.atan2(goal.y-me.y,goal.x-me.x);
  let diff=deltaAngle(desired,me.angle),throttle=1;
  if(Math.abs(diff)>Math.PI*0.58) {
    diff=deltaAngle(desired+Math.PI,me.angle);throttle=-1;
  }
  const turn=Math.abs(diff)<Math.max(0.035,physics.turn/2)?0:Math.sign(diff);
  const heading=me.angle+physics.turn*turn, step=stepDistance(throttle,physics);
  const next={x:me.x+step*Math.cos(heading),y:me.y+step*Math.sin(heading)};
  if(Math.abs(diff)>0.34||!validPose(next,walls)) throttle=0;
  return {throttle,turn,fire:false};
}

function chooseAim(me,enemies,walls,range,tick,physics) {
  const options=[me.angle];
  for(const t of enemies) options.push(Math.atan2(t.y-me.y,t.x-me.x));
  // Relative candidates turn with the hull. The staggered distant fan is
  // deterministic and limited to a few rays each tick.
  for(let k=1;k<=3;k++) options.push(me.angle+k*physics.turn,me.angle-k*physics.turn);
  if(tick%physics.ticks(3)===0) for(let k=0;k<16;k++) options.push((k/16+(tick%13)/208)*TAU);
  const laser=me.weapon==='laser',through=me.weapon==='death-ray';
  let best=null;
  for (const angle of options) {
    const shot=shotTrace(me,angle,enemies,walls,range,{radius:laser||through?0:3,through});
    if(!shot.target) continue;
    const turnCost=Math.abs(deltaAngle(angle,me.angle));
    const rank=shot.distance*0.002+shot.bounce*0.13+turnCost*0.8;
    if(!best||best.rank>rank) best={angle,rank,...shot};
  }
  return best;
}

export function createLaikaPolicy() {
  let round=-1,board=null,prior=null,blocked=0,unwedge=0,incumbent=null,aggression=0.5;
  return (obs) => {
    if (!Array.isArray(obs?.tanks)||!Array.isArray(obs.walls)||!Array.isArray(obs.bullets)||!validProfile(obs.profile)) return {...NEUTRAL};
    if (obs.round!==round||!board) {
      round=obs.round;board=newBoard(obs);prior=null;blocked=0;unwedge=0;incumbent=null;aggression=0.5;
    }
    const tick=obs.roundTick??obs.tick??0;
    const me=obs.tanks.find(t=>t.id===obs.playerId&&t.alive);
    if (!me||obs.phase==='intermission') return {...NEUTRAL};
    const profile=obs.profile, physics=kinetics(profile);
    const enemies=obs.tanks.filter(t=>t.alive&&t.id!==me.id);
    if(prior?.throttle) blocked=sqDist(prior,me)<0.2?blocked+1:0;
    else blocked=0;
    if(blocked>=physics.ticks(4)){unwedge=physics.ticks(10);blocked=0;}
    const home=board.cell(me),paths=routes(board,home);
    const liveShells=obs.bullets.filter(b=>b.owner===me.id&&b.kind==='shell').length;
    const ammo=liveShells<profile.shellLimit;
    const ordered=enemies.toSorted((a,b)=>paths.d[board.cell(a)]-paths.d[board.cell(b)]||sqDist(a,me)-sqDist(b,me));
    const target=ordered[0];
    const shotSpeed=me.weapon==='gatling'?profile.gatlingSpeed
      :['frag','missile','remote'].includes(me.weapon)?profile.missileSpeed:profile.shellSpeed;
    const range=me.weapon==='death-ray'?Math.hypot(obs.width,obs.height)
      :me.weapon==='laser'?profile.laserSpeed*profile.laserTtl:shotSpeed*physics.ticks(106);
    const bank=target&&(ammo||me.weapon)?chooseAim(me,ordered,board.walls,range,tick,physics):null;

    // Policy port: candidate scores compete each tick, with incumbent decay.
    // Source: Killfield laika.rs, make_decisions_and_update_goal.
    const goals=[];
    const offer=(kind,priority,point=null,aim=null)=>goals.push({kind,priority,point,aim});
    if (target) {
      const pathTo=paths.d[board.cell(target)], first=paths.first[board.cell(target)];
      offer('hunt',0.1,first<0?target:board.center(first));
      if (bank) {
        const priority=pathTo<=2?1.0:Math.max(0.35,(7-pathTo)/7*aggression);
        offer('shoot',priority,null,bank.angle);
      }
    }
    if (!ammo&&!me.weapon&&target) {
      const other=routes(board,board.cell(target));
      let retreat=-1,score=-Infinity;
      for(let i=0;i<other.d.length;i++) if(paths.d[i]>0&&paths.d[i]<=4) {
        const cand=other.d[i]-paths.d[i]*0.35;
        if(cand>score){retreat=i;score=cand;}
      }
      if(retreat>=0) offer('flee',0.7,board.center(paths.first[retreat]));
    }
    if(!me.weapon&&target) for(const p of obs.pickups??[]) {
      const dest=board.cell(p), hops=paths.d[dest];
      if(hops>=0&&hops<=4) offer('crate',0.37-hops*0.04,hops===0?p:board.center(paths.first[dest]));
    }
    if (incumbent) {
      const still=goals.find(g=>g.kind===incumbent.kind);
      if(still) still.priority=Math.max(still.priority,incumbent.priority*0.9);
    }
    goals.sort((a,b)=>b.priority-a.priority);
    const goal=goals[0];incumbent=goal;
    let action=drive(me,goal?.point,board.walls,physics);
    if (goal?.kind==='shoot') {
      const diff=deltaAngle(goal.aim,me.angle), turn=Math.abs(diff)<Math.max(0.03,physics.turn/2)?0:Math.sign(diff);
      action={throttle:0,turn,fire:false};
      if(Math.abs(diff)<0.10) {
        const direction=me.angle+turn*physics.turn;
        const shot=shotTrace(me,direction,ordered,board.walls,range,{
          radius:me.weapon==='laser'||me.weapon==='death-ray'?0:3,through:me.weapon==='death-ray'});
        action.fire=Boolean(shot.target&&!shot.self)&&!me.fireHeld;
        if(action.fire&&!prior?.fire) aggression=Math.max(0,aggression-0.2);
      }
    } else aggression=Math.min(0.5,aggression+0.01);
    const sustainingGatling=me.weapon==='gatling'&&me.weaponCharge>0&&(me.weaponAmmo??1)>0;
    if(sustainingGatling) action.fire=true;
    if(me.weapon==='frag'&&me.fragId) {
      const b=obs.bullets.find(b=>b.id===me.fragId);
      action.fire=Boolean(!me.fireHeld&&b&&sqDist(b,me)>53**2&&ordered.some(t=>sqDist(b,t)<70**2));
    }
    if(me.weapon==='mine') {
      action.fire=Boolean(!me.fireHeld&&target&&sqDist(me,target)<110**2&&
        Math.abs(deltaAngle(Math.atan2(target.y-me.y,target.x-me.x),me.angle))>Math.PI*0.53);
    }
    if(unwedge>0) {
      unwedge--;
      action={...NEUTRAL,throttle:-1,turn:tick%physics.ticks(20)<physics.ticks(10)?1:-1};
    }
    const samples=dangerSamples(me,obs.bullets,board.walls,physics);
    if (samples.some(row=>row.some(b=>sqDist(me,b)<27**2))) {
      const dodge=safestMotion(me,board.walls,samples,goal?.point,physics);
      action={throttle:dodge.throttle,turn:dodge.turn,fire:false};
    }
    if(action.fire&&me.fireHeld&&!sustainingGatling) action.fire=false;
    if(me.weapon==='gatling'&&me.weaponAmmo===0) action.fire=false;
    if(me.weapon==='remote'&&me.fragId) {
      const missile=obs.bullets.find(b=>b.id===me.fragId);
      if(missile&&target) {
        const diff=deltaAngle(Math.atan2(target.y-missile.y,target.x-missile.x),Math.atan2(missile.vy,missile.vx));
        action={...NEUTRAL,turn:Math.abs(diff)>profile.remoteTurn/2?Math.sign(diff):0};
      }
    }
    if(me.weapon==='death-ray'&&me.weaponCharge>0) action={...NEUTRAL};
    prior={x:me.x,y:me.y,...action};
    return action;
  };
}
