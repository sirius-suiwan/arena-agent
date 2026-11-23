// Shared presentation calculations. Never included in the simulation state hash.
export const emptyKillTotals = players => Object.fromEntries(players.map(id=>[id,0]));

export function countKills(current,events,teams) {
  let next=current;
  const seen=new Set();
  for (const event of events ?? []) {
    if (event?.type!=='destroyed') continue;
    const owner=event.ownerId ?? event.owner;
    const victim=event.tankId ?? event.targetId;
    if (owner==null || victim==null || owner===victim || (teams?.[owner] != null && teams[owner] === teams[victim]) || seen.has(victim) ||
        !Object.hasOwn(current,owner) || !Object.hasOwn(current,victim)) continue;
    if (next===current) next={...current};
    next[owner]++;
    seen.add(victim);
  }
  return next;
}

export function availableShellSlots(state,id) {
  const cap=state?.shellLimit;
  const limit=Number.isInteger(cap) && cap>=1 && cap<=32 ? cap : 5;
  const active=(state?.bullets ?? []).filter(b=>(b?.ownerId ?? b?.owner)===id &&
    (b.kind==null || b.kind==='shell')).length;
  return {limit,available:Math.max(0,limit-active)};
}
