const EPS=1e-7;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));

// The swept point model preserves axis reflection without the Flash movie's
// display-list hit shapes or its one-nominal-pixel integration steps.
export function traceLaser(arena,origin,range,{ignoreDistance=0,findTarget}={}) {
  let {x,y}=origin;
  let dx=Math.cos(origin.heading),dy=Math.sin(origin.heading),travel=0;
  const path=[{x,y}],bounces=[];
  for(let i=0;i<64&&range>EPS;i++){
    let d=range,flipX=false,flipY=false;
    function consider(distance,vertical) {
      if(distance<-EPS||distance>d+EPS) return;
      if(distance<d-EPS){d=Math.max(0,distance);flipX=false;flipY=false;}
      if(vertical) flipX=true; else flipY=true;
    }
    for(const w of arena.walls) {
      if(w.x1===w.x2&&Math.abs(dx)>EPS) {
        const t=(w.x1-x)/dx,at=y+dy*t;
        if(at>=w.y1-EPS&&at<=w.y2+EPS) consider(t,true);
      }
      if(w.y1===w.y2&&Math.abs(dy)>EPS) {
        const t=(w.y1-y)/dy,at=x+dx*t;
        if(at>=w.x1-EPS&&at<=w.x2+EPS) consider(t,false);
      }
    }
    // A wall wins an exact tie. Skip all tanks during the launch-protection
    // distance, not only the owner; a later ricochet can hit the shooter.
    const protectedPart=Math.max(0,ignoreDistance-travel);
    if(d>protectedPart+EPS) {
      const startX=x+dx*protectedPart,startY=y+dy*protectedPart;
      const endDistance=d-protectedPart;
      const target=findTarget?.(startX,startY,dx*endDistance,dy*endDistance);
      if(target&&(!flipX&&!flipY||target.f<1-EPS)) {
        const hit={x:startX+dx*endDistance*target.f,y:startY+dy*endDistance*target.f};
        path.push(hit);
        return {...hit,heading:Math.atan2(dy,dx),path,bounces,target,distance:travel+protectedPart+endDistance*target.f};
      }
    }
    x+=dx*d;y+=dy*d;travel+=d;range-=d;
    path.push({x,y});
    if(!flipX&&!flipY) break;
    if(flipX) dx=-dx;
    if(flipY) dy=-dy;
    bounces.push({x,y,dx,dy});
    const step=Math.min(EPS*4,range);
    // Keep internal coordinate outside the last wall for the next segment.
    // If a frame ended on the wall, the tiny offset also disambiguates the
    // heading when a later frame resumes the ray.
    x+=dx*Math.max(EPS*4,step);y+=dy*Math.max(EPS*4,step);
    travel+=step;range-=step;
  }
  return {x,y,heading:Math.atan2(dy,dx),path,bounces,distance:travel};
}

// Construct once at the first damaging frame. A signed circle tangent to
// the current direction and through the selected tank bends either way.
// Cap curvature by the original minimum radius and retarget after passing
// the selected tank, rather than tracking it on every damage tick.
export function traceDeathRay(arena,origin,candidates) {
  const stride=arena.profile.deathRaySegment;
  const radius=arena.profile.deathRayMinRadius;
  const inset=arena.profile.deathRayMargin;
  let {x,y,heading}=origin,goal=null,curvature=0;
  const remaining=new Set(candidates);
  const limit=Math.ceil(Math.hypot(arena.width,arena.height)*3/stride);
  const path=[{x,y}];
  for(let i=0;i<limit;i++) {
    const u=Math.cos(heading),v=Math.sin(heading);
    if(goal&&(goal.x-x)*u+(goal.y-y)*v<=EPS) {
      remaining.delete(goal);goal=null;
    }
    if(!goal) {
      let best=Infinity;
      for(const tank of remaining) {
        const ox=tank.x-x,oy=tank.y-y,d=ox*ox+oy*oy;
        if(ox*u+oy*v<=EPS||d>best) continue;
        goal=tank;best=d;
      }
      curvature=goal?clamp(2*(u*(goal.y-y)-v*(goal.x-x))/best,-1/radius,1/radius):0;
    }
    const turn=stride*curvature;
    const chord=turn?stride*Math.sin(turn/2)/(turn/2):stride;
    const dx=chord*Math.cos(heading+turn/2),dy=chord*Math.sin(heading+turn/2);
    const stop=Math.min(dx>EPS?(arena.width-inset-x)/dx:dx<-EPS?(inset-x)/dx:Infinity,
      dy>EPS?(arena.height-inset-y)/dy:dy<-EPS?(inset-y)/dy:Infinity);
    const part=clamp(stop,0,1);
    if(part<=EPS) break;
    x+=dx*part;y+=dy*part;heading+=turn*part;
    path.push({x,y});
    if(part<1) break;
  }
  return path;
}
