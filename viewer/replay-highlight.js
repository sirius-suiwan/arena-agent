const point = value => Number.isFinite(value?.x) && Number.isFinite(value?.y);
const roundKey = frame => frame.state.round;

// Completed replays let us identify a lethal projectile before its impact.
// IDs reset with each round. Keep impact rings separate from moving projectiles.
export function indexLethalProjectiles(frames) {
  const rounds = new Map();
  const impacts = new Map();
  for (const [index, frame] of frames.entries()) {
    const events = frame.events ?? [];
    for (const event of events) {
      if (event?.type !== 'destroyed' || event.bulletId == null) continue;
      const key = roundKey(frame);
      if (!rounds.has(key)) rounds.set(key, new Map());
      const lethal = rounds.get(key);
      const id = event.bulletId;
      const hit = events.find(item => item?.type === 'hit' && item.bulletId === id &&
        item.tankId === event.tankId && point(item));
      const ownerId = event.ownerId;
      if (!lethal.has(id)) lethal.set(id, {index, ownerId});
      if (hit) {
        if (!impacts.has(index)) impacts.set(index, []);
        impacts.get(index).push({x:hit.x,y:hit.y,ownerId});
      }
    }
  }
  return {rounds, impacts};
}

export function lethalProjectileRings(indexed, frame, index) {
  if (!indexed || !frame) return [];
  const lethal = indexed.rounds.get(roundKey(frame));
  const rings = [];
  for (const projectile of frame.state?.bullets ?? []) {
    const kill = lethal?.get(projectile?.id);
    // The snapshot at the killing tick may no longer contain the projectile.
    if (kill && index < kill.index && point(projectile)) {
      rings.push({x:projectile.x,y:projectile.y,ownerId:projectile.owner ?? kill.ownerId});
    }
  }
  rings.push(...(indexed.impacts.get(index) ?? []));
  return rings;
}
