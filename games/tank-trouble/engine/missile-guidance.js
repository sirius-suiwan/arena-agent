// Original-style navigation without bringing the maze graph or a cache into
// authoritative state. A round's wall array is shared by its immutable ticks.
const cache=new WeakMap();

function mazeFor({width,height,walls},cellSize) {
  const prior=cache.get(walls);
  if(prior?.width===width&&prior.height===height&&prior.cell===cellSize) return prior;
  const cols=width/cellSize,rows=height/cellSize;
  const closed=new Set();
  for(const wall of walls) {
    const vertical=wall.x1===wall.x2;
    const axis=vertical?wall.x1:wall.y1;
    if(axis%cellSize!==0) continue;
    const start=(vertical?wall.y1:wall.x1)/cellSize;
    const end=(vertical?wall.y2:wall.x2)/cellSize;
    for(let along=Math.ceil(start-0.5);along<=Math.floor(end-0.5);along++) {
      closed.add((vertical?'v':'h')+axis+':'+along);
    }
  }
  const gates=(vertical,axis,lane)=>closed.has((vertical?'v':'h')+axis+':'+lane);
  const cardinals=Array.from({length:cols*rows},(_,i)=>{
    const c=i%cols,r=Math.floor(i/cols),x=c*cellSize,y=r*cellSize;
    const adjacent=[];
    if(c>0&&!gates(true,x,r)) adjacent.push(i-1);
    if(r>0&&!gates(false,y,c)) adjacent.push(i-cols);
    if(c+1<cols&&!gates(true,x+cellSize,r)) adjacent.push(i+1);
    if(r+1<rows&&!gates(false,y+cellSize,c)) adjacent.push(i+cols);
    return adjacent;
  });
  // Diagonal shortcuts are permitted only if both passages around the
  // corner are completely open. Cardinal and diagonal distances differ.
  const links=cardinals.map((adjacent,i)=>{
    const links=adjacent.map(j=>[j,1]);
    const c=i%cols,r=Math.floor(i/cols);
    for(const dx of [-1,1]) for(const dy of [-1,1]) {
      if(c+dx<0||c+dx>=cols||r+dy<0||r+dy>=rows) continue;
      const horizontal=i+dx,vertical=i+dy*cols,both=horizontal+dy*cols;
      if(adjacent.includes(horizontal)&&adjacent.includes(vertical)&&
         cardinals[horizontal].includes(both)&&cardinals[vertical].includes(both)) {
        links.push([both,Math.SQRT2]);
      }
    }
    return links;
  });
  const coord=(n,max)=>Math.max(0,Math.min(max-1,Math.floor(n/cellSize)));
  const board={width,height,cell:cellSize,links,paths:new Map(),
    index:p=>coord(p.x,cols)+coord(p.y,rows)*cols,
    center:i=>({x:(i%cols+0.5)*cellSize,y:(Math.floor(i/cols)+0.5)*cellSize})};
  cache.set(walls,board);
  return board;
}

function routes(board,home) {
  if(board.paths.has(home)) return board.paths.get(home);
  const distance=new Float64Array(board.links.length).fill(Infinity);
  const first=new Int16Array(board.links.length).fill(-1);
  const queued=new Uint8Array(board.links.length);
  // Requeue cells only when a diagonal/cardinal combination improves their
  // distance; a one-visit unweighted queue would not give shortest lengths.
  const queue=[home];distance[home]=0;queued[home]=1;
  for(let i=0;i<queue.length;i++) {
    const current=queue[i];queued[current]=0;
    for(const [next,cost] of board.links[current]) {
      const length=distance[current]+cost;
      if(length>=distance[next]-1e-9) continue;
      distance[next]=length;
      first[next]=current===home?next:first[current];
      if(!queued[next]) {queue.push(next);queued[next]=1;}
    }
  }
  const found={distance,first};
  board.paths.set(home,found);
  return found;
}

export function homingWaypoint(state,bullet,cellSize,canHit) {
  const board=mazeFor(state,cellSize),home=board.index(bullet);
  const {distance,first}=routes(board,home);
  let target=null,goal=-1,best=Infinity;
  for(const tank of state.tanks) {
    if(!canHit(tank)) continue;
    const cell=board.index(tank),d=distance[cell];
    // The shooter may be the closest, but a tied rival takes priority.
    if(!Number.isFinite(d)||d>best+1e-9||Math.abs(d-best)<=1e-9&&tank.id===bullet.owner) continue;
    target=tank;goal=cell;best=d;
  }
  bullet.targetId=target?.id??null;
  return !target?null:goal===home?target:board.center(first[goal]);
}

export function accelerateMissile(bullet,ax,ay,maxSpeed) {
  bullet.vx+=ax;bullet.vy+=ay;
  const speed=Math.hypot(bullet.vx,bullet.vy);
  if(speed>maxSpeed) {bullet.vx*=maxSpeed/speed;bullet.vy*=maxSpeed/speed;}
}
