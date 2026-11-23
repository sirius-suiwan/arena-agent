const teams = [
  { fill: '#e12a29', light: '#f65549', shade: '#9d1417' },
  { fill: '#44a431', light: '#69c94e', shade: '#24631c' },
  { fill: '#2999d6', light: '#5dc3ee', shade: '#1b5b88' },
];
const graphite = { fill: '#545454', light: '#747474', shade: '#2f2f2f' };
const weapons = {
  'death-ray': '死光', laser: '激光', 'laser-sight': '激光', gatling: '加特林', frag: '破片弹', mine: '地雷',
  shell: '炮弹', shrapnel: '破片', shield: '护盾', rapid: '快速装填',
};

function team(index, mode) {
  return mode === 'human' && index === 1 ? graphite : teams[index % teams.length];
}

function pointIsValid(item) {
  return Number.isFinite(item?.x) && Number.isFinite(item?.y);
}

export function validateTankFrame(state) {
  return Number.isFinite(state?.width) && state.width > 0
    && Number.isFinite(state?.height) && state.height > 0
    && ['tanks', 'walls', 'bullets', 'pickups'].every((key) => Array.isArray(state[key]))
    && state.tanks.every((tank) => pointIsValid(tank) && typeof tank.id === 'string');
}

function layout(width, height, state) {
  const padding = Math.min(width, height) * 0.023;
  const scale = Math.min((width - 2 * padding) / state.width, (height - 2 * padding) / state.height);
  return { scale, x: (width - state.width * scale) / 2, y: (height - state.height * scale) / 2 };
}

/** Map a pointer in the displayed canvas to the authoritative board's coordinate space. */
export function projectTankPointer(canvas, state, clientX, clientY) {
  if (!validateTankFrame(state)) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const { scale, x, y } = layout(rect.width, rect.height, state);
  const worldX = (clientX - rect.left - x) / scale;
  const worldY = (clientY - rect.top - y) / scale;
  return {
    x: Math.max(0, Math.min(state.width, worldX)),
    y: Math.max(0, Math.min(state.height, worldY)),
  };
}

function fitCanvas(canvas) {
  const ratio = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return { ctx: canvas.getContext('2d'), width, height, ratio };
}

function box(ctx, x, y, w, h, r, fill, stroke = null, width = 1.2) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function tankGlyph(ctx, palette, weapon) {
  box(ctx, -10.4, -10.3, 19.3, 5.5, 1.2, '#282828', '#171717', 1.2);
  box(ctx, -10.4, 4.8, 19.3, 5.5, 1.2, '#282828', '#171717', 1.2);
  ctx.fillStyle = '#606060';
  for (const y of [-8.9, 6.4]) {
    for (const x of [-8, -4, 0, 4]) ctx.fillRect(x, y, 1.2, 2.3);
  }
  box(ctx, -9.9, -6.4, 18.9, 12.8, 1.5, palette.fill, '#181818', 2);
  ctx.fillStyle = palette.light;
  ctx.fillRect(-7.7, -4.8, 14.2, 1.6);
  ctx.fillStyle = palette.shade;
  ctx.fillRect(-7.7, 4.1, 14.2, 1.4);

  if (weapon === 'laser') {
    box(ctx, 2.8, -2.4, 10.5, 4.8, 1, '#535353', '#151515', 1.4);
    ctx.fillStyle = '#ed8b71';
    ctx.fillRect(10.6, -1.3, 1.6, 2.6);
  } else if (weapon === 'gatling') {
    box(ctx, 2.8, -2.7, 10.4, 5.4, 1, '#5e5e5e', '#151515', 1.4);
    ctx.fillStyle = '#151515';
    ctx.fillRect(7.5, -1.8, 1.1, 3.6);
    ctx.fillRect(10.5, -1.8, 1.1, 3.6);
  } else if (weapon === 'death-ray') {
    box(ctx, 2.8, -2.6, 10.8, 5.2, 1, '#575757', '#151515', 1.4);
    ctx.fillStyle = '#edc356';
    ctx.fillRect(10.2, -1.4, 2.1, 2.8);
  } else {
    box(ctx, 2.1, -1.8, 10.9, 3.6, 0.7, palette.fill, '#151515', 1.4);
  }
  box(ctx, -4.1, -4.2, 8.3, 8.4, 2.5, palette.light, '#151515', 1.6);
}

function drawCrate(ctx, pickup) {
  ctx.save();
  ctx.translate(pickup.x, pickup.y);
  box(ctx, -8, -8, 16, 16, 1.4, '#a8a8a8', '#292929', 1.9);
  ctx.fillStyle = '#d5d5d5';
  ctx.fillRect(-6.3, -6.1, 12.6, 1.1);
  ctx.fillStyle = '#313131';
  ctx.strokeStyle = '#313131';
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (pickup.type === 'laser' || pickup.type === 'laser-sight') {
    ctx.moveTo(-4.7, 4.5); ctx.lineTo(-1.1, -1.6); ctx.lineTo(1.8, 0.6); ctx.lineTo(4.5, -4.4);
    ctx.stroke();
  } else if (pickup.type === 'death-ray') {
    ctx.moveTo(-5, 4); ctx.lineTo(4.5, -4.5);
    ctx.moveTo(1, -4.5); ctx.lineTo(4.5, -4.5); ctx.lineTo(4.5, -1);
    ctx.moveTo(-5, 0.1); ctx.lineTo(-1.2, 0.1);
    ctx.stroke();
  } else if (pickup.type === 'gatling' || pickup.type === 'rapid') {
    for (const y of [-3.2, 0, 3.2]) {
      ctx.moveTo(-4.7, y); ctx.lineTo(4.5, y);
    }
    ctx.stroke();
    ctx.fillRect(-2, -4.5, 1.5, 9);
  } else if (pickup.type === 'mine') {
    ctx.ellipse(0, 2, 5.1, 2.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-2.6, 0); ctx.lineTo(-1.3, -2.7);
    ctx.lineTo(1.4, -2.7); ctx.lineTo(2.6, 0); ctx.stroke();
  } else if (pickup.type === 'frag') {
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      ctx.moveTo(Math.cos(angle) * 2.5, Math.sin(angle) * 2.5);
      ctx.lineTo(Math.cos(angle) * 5.3, Math.sin(angle) * 5.3);
    }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill();
  } else if (pickup.type === 'shield') {
    ctx.moveTo(-4, -3.3); ctx.lineTo(4, -3.3); ctx.lineTo(3.3, 1.7);
    ctx.lineTo(0, 4.8); ctx.lineTo(-3.3, 1.7); ctx.closePath(); ctx.stroke();
  } else {
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawPath(ctx, path) {
  if (!Array.isArray(path) || path.length < 2 || !path.every(pointIsValid)) return false;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
  return true;
}

function drawEffects(ctx, state, effects) {
  for (const { event, age } of effects) {
    const alpha = Math.max(0, 1 - age / 10);
    if (!alpha) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (event.type === 'weapon-fired' && event.weapon === 'death-ray'
        && [event.x, event.y, event.endX, event.endY].every(Number.isFinite)) {
      ctx.beginPath(); ctx.moveTo(event.x, event.y); ctx.lineTo(event.endX, event.endY);
      ctx.lineWidth = 4.4; ctx.strokeStyle = '#8d2929'; ctx.stroke();
      ctx.lineWidth = 1.7; ctx.strokeStyle = '#fff0a0'; ctx.stroke();
    } else if (event.type === 'weapon-fired' && event.weapon === 'laser' && drawPath(ctx, event.path)) {
      ctx.strokeStyle = '#b33931'; ctx.lineWidth = 3.6; ctx.stroke();
      ctx.strokeStyle = '#ffce8a'; ctx.lineWidth = 1.2; ctx.stroke();
    } else if (['mine-burst', 'frag-burst', 'destroyed'].includes(event.type)) {
      const point = pointIsValid(event) ? event : state.tanks.find((tank) => tank.id === event.tankId);
      if (pointIsValid(point)) {
        ctx.beginPath(); ctx.arc(point.x, point.y, 3 + age * 2, 0, Math.PI * 2);
        ctx.strokeStyle = '#525252'; ctx.lineWidth = 1.45; ctx.stroke();
        ctx.fillStyle = '#8c8c8c';
        for (let i = 0; i < 7; i++) {
          const a = i * 2.4;
          ctx.fillRect(point.x + Math.cos(a) * (age + 4), point.y + Math.sin(a) * (age + 4), 1.7, 1.7);
        }
      }
    }
    ctx.restore();
  }
}

/** Draw a read-only projection of an authoritative tank state; no art files from the original are used. */
export function drawTankFrame(canvas, state, { mode, effects = [] } = {}) {
  const { ctx, width, height, ratio } = fitCanvas(canvas);
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#e4e4e4';
  ctx.fillRect(0, 0, width, height);
  if (!validateTankFrame(state)) return;
  const { scale, x, y } = layout(width, height, state);
  ctx.setTransform(scale, 0, 0, scale, x, y);
  ctx.strokeStyle = '#494949';
  ctx.lineWidth = Math.max(5.2, 2.4 * ratio / scale);
  ctx.lineCap = 'square';
  ctx.beginPath();
  for (const wall of state.walls) {
    if (![wall?.x1, wall?.y1, wall?.x2, wall?.y2].every(Number.isFinite)) continue;
    ctx.moveTo(wall.x1, wall.y1);
    ctx.lineTo(wall.x2, wall.y2);
  }
  ctx.stroke();

  for (const pickup of state.pickups) if (pointIsValid(pickup)) drawCrate(ctx, pickup);
  for (const mine of Array.isArray(state.mines) ? state.mines : []) {
    if (!pointIsValid(mine)) continue;
    ctx.beginPath();
    ctx.ellipse(mine.x, mine.y, 6.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#3b3b3b'; ctx.fill();
    ctx.fillStyle = (state.roundTick ?? state.tick) >= mine.armedAt ? '#cf4134' : '#a3a3a3';
    ctx.fillRect(mine.x - 1.5, mine.y - 1.5, 3, 3);
  }
  for (const [index, tank] of state.tanks.entries()) {
    if (!pointIsValid(tank) || tank.alive === false) continue;
    if (drawPath(ctx, tank.aimGuide)) {
      ctx.save();
      ctx.setLineDash([3.4, 4.2]);
      ctx.strokeStyle = '#832f2c'; ctx.lineWidth = 1.25; ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(Number.isFinite(tank.angle) ? tank.angle : 0);
    tankGlyph(ctx, team(index, mode), tank.weapon);
    ctx.restore();
  }

  ctx.fillStyle = '#242424';
  for (const bullet of state.bullets) {
    if (!pointIsValid(bullet)) continue;
    const size = bullet.kind === 'frag' ? 4.1 : bullet.kind === 'gatling' || bullet.kind === 'shrapnel' ? 2.1 : 3.1;
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, Math.max(size, ratio / scale), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, state.width, state.height);
  ctx.clip();
  drawEffects(ctx, state, effects);
  ctx.restore();
}

export function drawScoreIcon(canvas, index, mode) {
  const { ctx, width, height } = fitCanvas(canvas);
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const scale = Math.min(width, height) / 29;
  ctx.setTransform(scale, 0, 0, scale, width / 2, height / 2);
  ctx.rotate(-0.58);
  tankGlyph(ctx, team(index, mode), null);
}

const eventLabels = {
  shot: '开火', bounce: '弹丸反弹', hit: '命中', pickup: '取得道具',
  'pickup-spawn': '道具刷新', 'shell-expired': '弹丸消失', 'shot-blocked': '未能开火',
  'wall-stop': '撞墙', 'tank-stop': '坦克碰撞', destroyed: '击毁', ended: '对局结束',
  timeout: '动作超时', 'weapon-fired': '使用武器', 'frag-burst': '破片炸开',
  'weapon-charge': '武器蓄力', 'last-tank-pending': '等待炮火结算', 'mine-placed': '埋设地雷', 'mine-burst': '地雷爆炸', 'round-start': '开局',
  'round-end': '本局结束',
};

export function formatTankEvent(event) {
  const type = event.type || '事件';
  const kind = eventLabels[type] ?? type;
  const hit = type === 'hit' || type === 'destroyed';
  const actor = event.playerId ?? event.player ?? event.shooter ?? event.ownerId ?? event.owner
    ?? (hit ? null : event.tankId);
  const target = event.targetId ?? event.target ?? (hit ? event.tankId : null);
  const shell = event.bulletId ?? event.shellId ?? event.shell;
  const position = Number.isFinite(event.x) && Number.isFinite(event.y)
    ? `(${event.x.toFixed(1)}, ${event.y.toFixed(1)})` : null;
  const weapon = event.pickupType ?? event.weapon;
  const labels = [kind, event.round == null ? null : `第 ${event.round} 局`,
    actor == null ? null : `选手 ${actor}`, target == null ? null : `目标 ${target}`,
    shell == null ? null : `弹丸 ${shell}`, weapon == null ? null : weapons[weapon] ?? weapon,
    event.winner == null ? null : `选手 ${event.winner} 获胜`,
    event.absorbed ? '护盾吸收' : null, position];
  return labels.filter(Boolean).join(' · ');
}
