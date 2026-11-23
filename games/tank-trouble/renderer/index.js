const teamColors = ['#69d8ff', '#ff9077', '#8eedaa', '#fcd879'];

function pointIsValid(item) {
  return Number.isFinite(item?.x) && Number.isFinite(item?.y);
}

export function validateTankFrame(state) {
  return Number.isFinite(state?.width) && state.width > 0
    && Number.isFinite(state?.height) && state.height > 0
    && ['tanks', 'walls', 'bullets', 'pickups'].every((key) => Array.isArray(state[key]));
}

/** Draw a read-only projection of an authoritative tank state. */
export function drawTankFrame(canvas, state) {
  const ratio = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b1420';
  ctx.fillRect(0, 0, width, height);

  const mapWidth = state?.width;
  const mapHeight = state?.height;
  if (!Number.isFinite(mapWidth) || !Number.isFinite(mapHeight) || mapWidth <= 0 || mapHeight <= 0) return;
  const padding = Math.min(width, height) * 0.055;
  const scale = Math.min((width - 2 * padding) / mapWidth, (height - 2 * padding) / mapHeight);
  const mapUnit = Math.min(mapWidth, mapHeight);
  const tile = mapUnit * 0.028;
  ctx.setTransform(scale, 0, 0, scale, (width - scale * mapWidth) / 2, (height - scale * mapHeight) / 2);
  ctx.fillStyle = '#172639';
  ctx.fillRect(0, 0, mapWidth, mapHeight);

  ctx.strokeStyle = '#748da7';
  ctx.lineWidth = Math.max(tile * 0.14, 1.4 * ratio / scale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const wall of state.walls ?? []) {
    if (![wall?.x1, wall?.y1, wall?.x2, wall?.y2].every(Number.isFinite)) continue;
    ctx.moveTo(wall.x1, wall.y1);
    ctx.lineTo(wall.x2, wall.y2);
  }
  ctx.stroke();

  for (const pickup of state.pickups ?? []) {
    if (!pointIsValid(pickup)) continue;
    ctx.save();
    ctx.translate(pickup.x, pickup.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffd479';
    ctx.fillRect(-tile / 2, -tile / 2, tile, tile);
    ctx.restore();
  }

  for (const [index, tank] of (state.tanks ?? []).entries()) {
    if (!pointIsValid(tank)) continue;
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(Number.isFinite(tank.angle) ? tank.angle : 0);
    ctx.globalAlpha = tank.alive === false ? 0.29 : 1;
    ctx.fillStyle = '#0f1a2a';
    ctx.fillRect(-tile * 0.9, -tile * 0.72, tile * 1.8, tile * 1.44);
    ctx.fillStyle = teamColors[index % teamColors.length];
    ctx.fillRect(-tile * 0.74, -tile * 0.5, tile * 1.48, tile);
    ctx.fillRect(0, -tile * 0.13, tile * 1.22, tile * 0.26);
    ctx.restore();
  }

  ctx.fillStyle = '#fff1bc';
  for (const bullet of state.bullets ?? []) {
    if (!pointIsValid(bullet)) continue;
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, Math.max(tile * 0.15, ratio / scale), 0, Math.PI * 2);
    ctx.fill();
  }
}

const names = {
  shot: '开火', bounce: '弹丸反弹', hit: '命中', pickup: '取得道具',
  'pickup-spawn': '道具刷新', 'shell-expired': '弹丸消失', 'shot-blocked': '未能开火',
  'wall-stop': '撞墙', 'tank-stop': '坦克碰撞', destroyed: '击毁', ended: '对局结束',
  timeout: '动作超时',
};

export function formatTankEvent(event) {
  const type = event.type || '事件';
  const kind = names[type] ?? type;
  const hit = type === 'hit' || type === 'destroyed';
  const actor = event.playerId ?? event.player ?? event.shooter ?? event.ownerId ?? event.owner
    ?? (hit ? null : event.tankId);
  const target = event.targetId ?? event.target ?? (hit ? event.tankId : null);
  const shell = event.bulletId ?? event.shellId ?? event.shell;
  const position = Number.isFinite(event.x) && Number.isFinite(event.y)
    ? `(${event.x.toFixed(1)}, ${event.y.toFixed(1)})` : null;
  const labels = [kind, actor == null ? null : `选手 ${actor}`,
    target == null ? null : `目标 ${target}`, shell == null ? null : `弹丸 ${shell}`,
    event.pickupType ?? null, event.absorbed ? '护盾吸收' : null, position];
  return labels.filter(Boolean).join(' · ');
}
