const EPS=1e-7;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function firstInteriorCrossing({width,height,walls},x,y,dx,dy) {
  let earliest=Infinity;
  for(const wall of walls) {
    const vertical=wall.x1===wall.x2;
    const coordinate=vertical?wall.x1:wall.y1;
    if (coordinate<=0||coordinate>=(vertical?width:height)) continue;
    const velocity=vertical?dx:dy;
    if(Math.abs(velocity)<=EPS) continue;
    const fraction=(coordinate-(vertical?x:y))/velocity;
    if(fraction<=EPS||fraction>1+EPS||fraction>=earliest) continue;
    const along=vertical?y+dy*fraction:x+dx*fraction;
    const lo=vertical?wall.y1:wall.x1,hi=vertical?wall.y2:wall.x2;
    if(along>=lo-EPS&&along<=hi+EPS) earliest=Math.min(1,fraction);
  }
  return earliest;
}

// The laser is straight until piercing an internal wall. Thereafter it
// accumulates clockwise curvature. Chords subdivide the trajectory for hit
// tests, and every segment is clipped to the map perimeter, not its walls.
export function traceLaser(arena,{x,y,heading,curved=false},range,findTarget) {
  const {profile,width,height}=arena;
  const segmentLength=profile.laserMaxSegment;
  const curvature=profile.laserBendPerTick/profile.laserSpeed;
  if (!Number.isFinite(segmentLength)||segmentLength<=0||!Number.isFinite(curvature)) {
    throw new Error('invalid laser geometry profile');
  }
  const path=[{x,y}];
  while (range>EPS) {
    const length=Math.min(segmentLength,range);
    const bend=curved?curvature*length:0;
    const chord=bend===0?length:length*Math.sin(bend/2)/(bend/2);
    const dx=Math.cos(heading+bend/2)*chord,dy=Math.sin(heading+bend/2)*chord;
    const edge=Math.min(dx>EPS?(width-x)/dx:dx<-EPS?-x/dx:Infinity,
      dy>EPS?(height-y)/dy:dy<-EPS?-y/dy:Infinity);
    const crossing=curved?Infinity:firstInteriorCrossing(arena,x,y,dx,dy);
    const target=findTarget?.(x,y,dx,dy,edge,crossing);
    const fraction=clamp(Math.min(crossing,target?.f??edge),0,1);
    x=clamp(x+dx*fraction,0,width);
    y=clamp(y+dy*fraction,0,height);
    heading+=bend*fraction;
    path.push({x,y});
    if (target||edge<=1&&edge<=crossing) return {x,y,heading,curved,path,target,atBoundary:!target};
    if (crossing<=1) {
      curved=true;
      range-=length*fraction;
    } else range-=length;
  }
  return {x,y,heading,curved,path};
}
