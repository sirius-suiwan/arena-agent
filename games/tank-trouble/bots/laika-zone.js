// A private destination lets built-in Laika route through the actual maze early.
// The route is cached per round and is never exposed through public observations.
const CELL=64;
const HULL=12;
const d2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const cellOf=value=>Math.floor(value/CELL);
const nearCenter=(col,row)=>({x:(col+0.5)*CELL,y:(row+0.5)*CELL});
const edgeKey=(x1,y1,x2,y2)=>[x1,y1,x2,y2].join(',');
const wrap=n=>Math.atan2(Math.sin(n),Math.cos(n));

function routesTo(goal,obs) {
  const cols=obs.width/CELL,rows=obs.height/CELL;
  const target=cellOf(goal.y)*cols+cellOf(goal.x);
  const walls=new Set(obs.walls.map(w=>{
    const [a,b,c,d]=[w.x1,w.y1,w.x2,w.y2].map(n=>n/CELL);
    return a<c||b<d?edgeKey(a,b,c,d):edgeKey(c,d,a,b);
  }));
  const next=new Int16Array(cols*rows).fill(-1), distance=new Int16Array(cols*rows).fill(-1);
  next[target]=target; distance[target]=0;
  const queue=[target];
  for(let i=0;i<queue.length;i++) {
    const index=queue[i],x=index%cols,y=Math.floor(index/cols);
    for(const [cx,cy,wall] of [
      [x-1,y,edgeKey(x,y,x,y+1)],[x+1,y,edgeKey(x+1,y,x+1,y+1)],
      [x,y-1,edgeKey(x,y,x+1,y)],[x,y+1,edgeKey(x,y+1,x+1,y+1)]
    ]) {
      const neighbor=cy*cols+cx;
      if(cx<0||cy<0||cx>=cols||cy>=rows||next[neighbor]!==-1||walls.has(wall)) continue;
      next[neighbor]=index; distance[neighbor]=distance[index]+1; queue.push(neighbor);
    }
  }
  return {target,next,distance};
}

export function makeZoneStaging({blockedByWall,pose,safeToRecover,teamMate}) {
  let cached;
  const reset=()=>{cached=null;};
  function apply(message,base,me,obs) {
    const goal=message.shrinkDestination,zone=obs.zone,now=obs.roundTick;
    if(!goal||!zone||!Number.isInteger(now)||goal.startsAt!==zone.startTick||
       goal.endsAt!==zone.endTick||now>=goal.endsAt||base.fire||me.weaponCharge>0||
       ![goal.x,goal.y,zone.finalHalfWidth,zone.finalHalfHeight].every(Number.isFinite)||
       !Number.isInteger(obs.width/CELL)||!Number.isInteger(obs.height/CELL)||
       goal.x<zone.finalHalfWidth||goal.x>obs.width-zone.finalHalfWidth||
       goal.y<zone.finalHalfHeight||goal.y>obs.height-zone.finalHalfHeight) return base;
    const cols=obs.width/CELL,index=cellOf(me.y)*cols+cellOf(me.x);
    if(!cached||cached.round!==obs.round||cached.width!==obs.width||
       cached.height!==obs.height||cached.x!==goal.x||cached.y!==goal.y) {
      cached={round:obs.round,width:obs.width,height:obs.height,...goal,...routesTo(goal,obs)};
    }
    const steps=cached.distance[index];
    if(steps===undefined||steps<0) return base;
    // Account for maze distance, not Euclidean distance through walls. Give
    // extra time for turning/contests, but don't disregard pickups all round.
    const speed=obs.profile.forwardSpeed*obs.profile.tickRate;
    if((goal.startsAt-now)/obs.profile.tickRate>6+1.45*steps*CELL/speed) return base;
    const others=obs.tanks.filter(t=>t.alive&&t!==me);
    if(others.some(t=>!teamMate(obs,me,t)&&d2(me,t)<88**2)||!safeToRecover(obs,me,me)) return base;
    const current=nearCenter(index%cols,Math.floor(index/cols));
    const next=cached.next[index];
    let waypoint=index===cached.target?goal:nearCenter(next%cols,Math.floor(next/cols));
    if(index!==cached.target&&blockedByWall(me,waypoint,obs.walls,HULL)) waypoint=current;
    const intended=pose(me,base,obs);
    if(d2(me,goal)<=8**2) {
      return d2(intended,goal)<=10**2?base:{throttle:0,turn:base.turn,fire:false};
    }
    const error=wrap(Math.atan2(waypoint.y-me.y,waypoint.x-me.x)-me.angle);
    const throttle=Math.abs(error)>Math.PI/2?-1:1;
    const steering=throttle<0?wrap(error+Math.PI):error;
    const turn=Math.abs(steering)>obs.profile.turnSpeed/2?Math.sign(steering):0;
    const action={throttle:Math.abs(steering-turn*obs.profile.turnSpeed)<0.45?throttle:0,turn,fire:false};
    if(!action.throttle) return turn?action:base;
    const planned=pose(me,action,obs);
    const clearance=2*HULL+obs.profile.forwardSpeed;
    if(d2(planned,waypoint)>=d2(me,waypoint)||others.some(t=>d2(planned,t)<clearance**2)||
       !safeToRecover(obs,me,planned)) return turn?{...action,throttle:0}:base;
    return action;
  }
  return {apply,reset};
}
