const point = value => Number.isFinite(value?.x) && Number.isFinite(value?.y)
  ? {x:value.x,y:value.y} : null;

// Bullet IDs are only unique inside one round. Never pull a previous round's path.
export function killHighlight(frames,index,event) {
  if (event?.type!=='destroyed' || event.bulletId == null || !frames[index]) return null;
  const bulletId=event.bulletId;
  const targetId=event.tankId ?? event.targetId;
  const last=frames[index], round=last.state?.round;
  const matching = item => item?.bulletId===bulletId;
  const hitEvent=(last.events ?? []).find(item => matching(item) && item.type==='hit' &&
    (item.tankId ?? item.targetId)===targetId);
  const hit=point(hitEvent) ?? point(last.state?.tanks?.find(t=>t.id===targetId));
  let ownerId=event.ownerId ?? hitEvent?.ownerId ?? null;
  let first=index;
  for (; first>=0 && frames[first].state?.round===round; first--) {
    const launch=(frames[first].events ?? []).find(item=>matching(item) && (item.type==='shot'||item.type==='weapon-fired'));
    if (launch) {
      ownerId ??= launch.ownerId ?? launch.tankId ?? null;
      break;
    }
    const bullet=frames[first].state?.bullets?.find(item=>item.id===bulletId);
    ownerId ??= bullet?.owner ?? null;
  }
  const points=[];
  const append = value => {
    const p=point(value), end=points.at(-1);
    if (p && (!end || p.x!==end.x || p.y!==end.y)) points.push(p);
  };
  for (let i=Math.max(0,first);i<=index;i++) {
    const frame=frames[i];
    if (frame.state?.round!==round) continue;
    for (const item of frame.events ?? []) {
      if (!matching(item)) continue;
      if (item.type==='weapon-fired') {
        if (Array.isArray(item.path)) for (const p of item.path) append(p);
        else {
          append(item);
          append({x:item.endX,y:item.endY});
        }
      } else if (item.type==='shot' || item.type==='bounce') append(item);
    }
    const bullet=frame.state?.bullets?.find(item=>item.id===bulletId);
    append(bullet);
  }
  // A ray may pass the victim; keep its real path rather than drawing backward.
  if (!points.length || !(last.events ?? []).some(item=>matching(item)&&item.type==='weapon-fired')) append(hit);
  if (!points.length) return null;
  return {ownerId,bulletId,points,hit,selfHit:ownerId!=null&&ownerId===targetId};
}
