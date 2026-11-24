const teams = [
  { hull: '#dc655f', turret: '#f18c80', track: '#913c3b', outline: '#653535' },
  { hull: '#48a783', turret: '#7bc8a7', track: '#2f705c', outline: '#2d5549' },
  { hull: '#448ec0', turret: '#77aed0', track: '#315f85', outline: '#314c68' },
  { hull: '#d99138', turret: '#efbb69', track: '#946126', outline: '#725025' },
  { hull: '#956ac2', turret: '#bd98e1', track: '#60488a', outline: '#513b6e' },
  { hull: '#2faeb3', turret: '#7bd1d0', track: '#236e72', outline: '#285c62' },
  { hull: '#c767a0', turret: '#e49ac2', track: '#834269', outline: '#713754' },
  { hull: '#91a83e', turret: '#c0cd73', track: '#607629', outline: '#4b5e26' },
];
const squadLetter = (id) => 'ABCD'[Number(id) - 1] ?? id;
const squadColors = Object.freeze({ '1': '#84365c', '2': '#166558', '3': '#315b99', '4': '#825417' });
const graphite = { hull: '#6b7385', turret: '#959dae', track: '#484e5b', outline: '#383e4b' };
const weapons = {
  'death-ray': '死光', laser: '激光', gatling: '加特林', frag: '破片弹', mine: '地雷',
  missile: '追踪导弹', remote: '遥控导弹', shell: '炮弹', shrapnel: '破片',
};

function team(index, mode, id) {
  const slot = typeof id === 'string' && /^[A-H]$/.test(id) ? id.charCodeAt(0) - 65 : index;
  return slot < 0 || (mode === 'human' && slot === 1) ? graphite : teams[slot % teams.length];
}

function teamForOwner(state, mode, id) {
  return team(state.tanks.findIndex((tank) => tank.id === id), mode, id);
}

function pointIsValid(item) {
  return Number.isFinite(item?.x) && Number.isFinite(item?.y);
}

function validateTankFrame(state) {
  return Number.isFinite(state?.width) && state.width > 0
    && Number.isFinite(state?.height) && state.height > 0
    && ['tanks', 'walls', 'bullets', 'pickups'].every((key) => Array.isArray(state[key]))
    && state.tanks.every((tank) => pointIsValid(tank) && typeof tank.id === 'string');
}

function layout(width, height, state) {
  const padding = Math.min(width, height) * 0.009;
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

export function tankSeatColor(index, mode, id) {
  return team(index, mode, id).hull;
}

function roundedGlyph(ctx, x, y, w, h, radius, paint, outline, line = 1.15) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = paint;
  ctx.fill();
  if (outline) {
    ctx.lineWidth = line;
    ctx.strokeStyle = outline;
    ctx.stroke();
  }
}

function stageTankGlyph(ctx, color) {
  ctx.lineJoin = 'round';
  roundedGlyph(ctx, -10.8, -9.6, 19.7, 4.6, 1.5, color.track, color.outline);
  roundedGlyph(ctx, -10.8, 5, 19.7, 4.6, 1.5, color.track, color.outline);
  roundedGlyph(ctx, -9.2, -5.8, 17.8, 11.6, 2.1, color.hull, color.outline);
  roundedGlyph(ctx, 2.3, -1.9, 11.2, 3.8, 0.8, color.hull, color.outline);
  ctx.beginPath();
  ctx.arc(-0.45, 0, 4.6, 0, Math.PI * 2);
  ctx.fillStyle = color.turret;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = color.outline;
  ctx.stroke();
}

const weaponInks = {
  'death-ray': '#af3952', laser: '#9d396d',
  gatling: '#9b6118', mine: '#564879', frag: '#258170',
  missile: '#34668c', remote: '#796239',
};

// Low, wide silhouette reads as a mine even at HUD size. The placed
// version uses the same shape without the pickup badge and colors by owner.
function mineGlyph(ctx, paint, outline, lamp, triggered = false) {
  ctx.lineJoin = 'round';
  if (triggered) {
    ctx.beginPath(); ctx.arc(0, 0, 8.1, 0, Math.PI * 2);
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#a84a25'; ctx.stroke();
  }
  roundedGlyph(ctx, -5.8, -0.5, 11.6, 4.5, 1.6, paint, outline, 1.05);
  ctx.beginPath(); ctx.ellipse(0, -1, 4.8, 2.65, 0, 0, Math.PI * 2);
  ctx.fillStyle = paint; ctx.fill();
  ctx.lineWidth = 1.05; ctx.strokeStyle = outline; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -1.35, 1.3, 0, Math.PI * 2);
  ctx.fillStyle = lamp; ctx.fill();
  ctx.lineWidth = 0.85; ctx.stroke();
}

function weaponGlyph(ctx, kind) {
  const color = Object.hasOwn(weaponInks, kind) ? weaponInks[kind] : '#555d71';
  roundedGlyph(ctx, -7.2, -7.2, 14.4, 14.4, 2.3, '#f8f7f4', color, 1.05);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'laser') {
    ctx.moveTo(-4.5, 4.2); ctx.lineTo(-1.2, -2.6); ctx.lineTo(1.5, 2); ctx.lineTo(4.3, -4);
    ctx.stroke();
  } else if (kind === 'death-ray') {
    ctx.moveTo(-4.1, 4.1); ctx.lineTo(4.1, -4.1);
    ctx.moveTo(0.6, -4.1); ctx.lineTo(4.1, -4.1); ctx.lineTo(4.1, -0.6);
    ctx.stroke();
  } else if (kind === 'gatling') {
    for (const y of [-3.3, 0, 3.3]) {
      ctx.moveTo(-4, y); ctx.lineTo(4, y);
    }
    ctx.stroke();
  } else if (kind === 'mine') {
    mineGlyph(ctx, '#ded7ee', color, '#f5d489');
  } else if (kind === 'frag') {
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      ctx.moveTo(Math.cos(a) * 2.2, Math.sin(a) * 2.2);
      ctx.lineTo(Math.cos(a) * 4.8, Math.sin(a) * 4.8);
    }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 1.15, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'missile') {
    ctx.moveTo(-3.8, 3.8); ctx.lineTo(4.4, -4.4);
    ctx.moveTo(-.2, -4.4); ctx.lineTo(4.4, -4.4); ctx.lineTo(4.4, .2);
    ctx.moveTo(-4, .6); ctx.lineTo(-.6, 4);
    ctx.stroke();
  } else if (kind === 'remote') {
    ctx.moveTo(0, 4); ctx.lineTo(0, .5);
    ctx.moveTo(-2, -1); ctx.quadraticCurveTo(0, -3, 2, -1);
    ctx.moveTo(-4, -2.5); ctx.quadraticCurveTo(0, -6, 4, -2.5);
    ctx.stroke();
  } else {
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill();
  }
}

function drawCrate(ctx, pickup, crateScale) {
  ctx.save();
  ctx.translate(pickup.x, pickup.y);
  ctx.scale(crateScale, crateScale);
  weaponGlyph(ctx, pickup.type);
  ctx.restore();
}

export function equippedTankWeapon(tank) {
  if (!tank?.alive) return null;
  if (typeof tank.weapon === 'string' && Object.hasOwn(weapons, tank.weapon)) return tank.weapon;
  return null;
}

export function tankWeaponLabel(weapon) {
  return Object.hasOwn(weapons, weapon) ? weapons[weapon] : '';
}

function pickupHint(event) {
  if (event.type === 'pickup-blocked') {
    const name = tankWeaponLabel(event.heldWeapon);
    return name ? `已装备${name}，不能再拾取` : '已有道具，不能再拾取';
  }
  const name = tankWeaponLabel(event.pickupType) || '道具';
  const hold = event.activation === 'hold';
  if (event.releaseRequired) return hold ? `${name} · 松开后按住开火` : `${name} · 松开后再按开火`;
  if (event.pickupType === 'remote') return `${name} · 发射后用转向键操控`;
  if (event.pickupType === 'frag') return `${name} · 按开火发射，再按引爆`;
  return hold ? `${name} · 按住开火` : `${name} · 按开火`;
}

function drawPickupFeedback(ctx, state, effects) {
  const shown = new Set();
  for (const { event, age } of effects) {
    if (!['pickup', 'pickup-blocked'].includes(event.type) || age >= 60 || shown.has(event.tankId)) continue;
    const tank = state.tanks.find((item) => item.id === event.tankId && item.alive !== false);
    if (!tank) continue;
    shown.add(event.tankId);
    ctx.save();
    ctx.globalAlpha = Math.min(1, (60 - age) / 13);
    if (event.type === 'pickup' && age < 24) {
      ctx.beginPath(); ctx.arc(tank.x, tank.y, 13 + age * 0.3, 0, Math.PI * 2);
      ctx.strokeStyle = '#464646'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    const text = pickupHint(event);
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const labelWidth = Math.min(state.width - 10, (ctx.measureText(text)?.width ?? text.length * 11) + 8);
    const center = Math.max(5 + labelWidth / 2, Math.min(state.width - 5 - labelWidth / 2, tank.x));
    const top = tank.y >= 35 ? tank.y - 31 : tank.y + 16;
    ctx.fillStyle = '#f1f1f1';
    ctx.fillRect(center - labelWidth / 2, top, labelWidth, 15);
    ctx.fillStyle = '#252525';
    ctx.fillText(text, center, top + 7.5, labelWidth - 4);
    ctx.restore();
  }
}

function drawPath(ctx, path) {
  if (!Array.isArray(path) || path.length < 2 || !path.every(pointIsValid)) return false;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
  return true;
}

function drawLaserTrail(ctx, path, tint, outline = tint.outline) {
  if (!drawPath(ctx, path)) return false;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3.3;
  ctx.stroke();
  ctx.strokeStyle = tint.turret;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
  return true;
}

function drawEffects(ctx, state, effects, mode) {
  for (const { event, age } of effects) {
    if (event.type==='shell-expired'&&event.kind==='shrapnel'&&event.reason==='wall') {
      const lifetime=60*(state.profile?.fragmentFadeSeconds??0.8);
      if(age<lifetime&&pointIsValid(event)) {
        ctx.save();
        ctx.globalAlpha=1-age/lifetime;
        ctx.fillStyle=teamForOwner(state,mode,event.ownerId).outline;
        ctx.beginPath(); ctx.arc(event.x,event.y,1.7,0,Math.PI*2); ctx.fill();
        ctx.restore();
      }
      continue;
    }
    if (event.type === 'laser-path') {
      if (age === 0 && !state.bullets.some(bullet => bullet.id === event.bulletId)) {
        drawLaserTrail(ctx, event.path, teamForOwner(state, mode, event.ownerId));
      }
      continue;
    }
    const continuous = event.continuous === true || event.type === 'death-ray-beam';
    if (continuous && age !== 0) continue;
    const alpha = continuous ? 1 : Math.max(0, 1 - age / 10);
    if (!alpha) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    const tint = teamForOwner(state, mode, event.ownerId ?? event.tankId);
    if (continuous
        && [event.x, event.y, event.endX, event.endY].every(Number.isFinite)) {
      ctx.beginPath(); ctx.moveTo(event.x, event.y); ctx.lineTo(event.endX, event.endY);
      ctx.lineWidth = 4.2; ctx.strokeStyle = tint.outline; ctx.stroke();
      ctx.lineWidth = 2.5; ctx.strokeStyle = tint.hull; ctx.stroke();
      ctx.lineWidth = 0.9; ctx.strokeStyle = tint.turret; ctx.stroke();
    } else if (['mine-burst', 'frag-burst', 'destroyed', 'zone-eliminated'].includes(event.type)) {
      const point = pointIsValid(event) ? event : state.tanks.find((tank) => tank.id === event.tankId);
      if (pointIsValid(point)) {
        ctx.beginPath(); ctx.arc(point.x, point.y, 3 + age * 2, 0, Math.PI * 2);
        ctx.strokeStyle = tint.outline; ctx.lineWidth = 1.45; ctx.stroke();
        ctx.fillStyle = tint.hull;
        for (let i = 0; i < 7; i++) {
          const a = i * 2.4;
          ctx.fillRect(point.x + Math.cos(a) * (age + 4), point.y + Math.sin(a) * (age + 4), 1.7, 1.7);
        }
      }
    }
    ctx.restore();
  }
}

function drawLethalRings(ctx, state, mode, rings) {
  for (const ring of rings) {
    if (!pointIsValid(ring)) continue;
    const color = teamForOwner(state, mode, ring.ownerId);
    ctx.save();
    ctx.beginPath(); ctx.arc(ring.x, ring.y, 6.8, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.8; ctx.stroke();
    ctx.strokeStyle = color.outline; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.restore();
  }
}

/** Draw a read-only projection of an authoritative tank state; no art files from the original are used. */
function drawZone(ctx, state, scale, ratio, outsideAlpha) {
  const zone = state.zone;
  if (!pointIsValid(zone) || ![zone.halfWidth, zone.halfHeight].every((half) => Number.isFinite(half) && half > 0)) return;
  const { x, y, halfWidth, halfHeight } = zone;
  const left = x - halfWidth, top = y - halfHeight;
  const width = 2 * halfWidth, height = 2 * halfHeight;
  if (left <= 0 && top <= 0 && x + halfWidth >= state.width && y + halfHeight >= state.height) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, state.width, state.height);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(0, 0, state.width, state.height);
  ctx.rect(left, top, width, height);
  ctx.fillStyle = `rgba(134,71,42,${outsideAlpha})`;
  ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(154,77,39,0.78)';
  ctx.lineWidth = Math.max(1.35, 1.2 * ratio / scale);
  ctx.strokeRect(left, top, width, height);
  ctx.restore();
}

export function drawTankFrame(canvas, state, { mode, teams = state.teams ?? {}, effects = [], lethalRings = [] } = {}) {
  const { ctx, width, height, ratio } = fitCanvas(canvas);
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  if (!validateTankFrame(state)) return;
  const { scale, x, y } = layout(width, height, state);
  ctx.setTransform(scale, 0, 0, scale, x, y);
  ctx.fillStyle = '#e6e6e6';
  ctx.fillRect(0, 0, state.width, state.height);

  // Replay drawing uses the tuning captured in each frame, not the current JSON.
  // Built-in visual defaults guard against missing or invalid configuration.
  const configured = state.profile?.render;
  const positive = (key, fallback) => {
    const value = configured?.[key];
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const alpha = configured?.zoneOutsideAlpha;
  const outsideAlpha = Number.isFinite(alpha) && alpha >= 0 && alpha <= 1 ? alpha : 0.22;
  const tankScale = positive('tankScale', 1);
  const crateScale = positive('crateScale', 1);
  const missileScale = positive('missileScale', 1);
  const shellRadius = positive('shellRadius', 3);
  const gatlingRadius = positive('gatlingRadius', 1.35);
  const shrapnelRadius = positive('shrapnelRadius', 2.1);
  drawZone(ctx, state, scale, ratio, outsideAlpha);

  // Static exterior walls match the interior gray; the thin black rim sits at the outer edge.
  const wallWidth = Math.max(positive('wallWidth', 5.2), 1.7 * ratio / scale);
  ctx.strokeStyle = '#4c4c4c';
  ctx.lineWidth = wallWidth;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.strokeRect(0, 0, state.width, state.height);
  ctx.beginPath();
  for (const wall of state.walls) {
    if (![wall?.x1, wall?.y1, wall?.x2, wall?.y2].every(Number.isFinite)) continue;
    const exterior = (wall.x1 === wall.x2 && (wall.x1 === 0 || wall.x1 === state.width)) ||
      (wall.y1 === wall.y2 && (wall.y1 === 0 || wall.y1 === state.height));
    if (exterior) continue;
    ctx.moveTo(wall.x1, wall.y1);
    ctx.lineTo(wall.x2, wall.y2);
  }
  ctx.stroke();
  const rim = wallWidth / 2;
  ctx.strokeStyle = '#111';
  ctx.lineWidth = ratio / scale;
  ctx.strokeRect(-rim, -rim, state.width + 2 * rim, state.height + 2 * rim);

  for (const pickup of state.pickups) if (pointIsValid(pickup)) drawCrate(ctx, pickup, crateScale);
  for (const mine of Array.isArray(state.mines) ? state.mines : []) {
    if (!pointIsValid(mine) || mine.visibility===0) continue;
    const color = teamForOwner(state, mode, mine.owner);
    const triggered = Number.isFinite(mine.detonateAt);
    const armed = mine.activatedAt != null;
    ctx.save();
    ctx.globalAlpha=mine.visibility??1;
    ctx.translate(mine.x, mine.y);
    mineGlyph(ctx, color.hull, color.outline, triggered ? '#f5ad4b' : armed ? '#f9e4a7' : color.turret, triggered);
    ctx.restore();
  }
  for (const [index, tank] of state.tanks.entries()) {
    if (!pointIsValid(tank) || tank.alive === false) continue;
    const color = team(index, mode, tank.id);
    const squad = teams[tank.id];
    if (drawPath(ctx, tank.aimGuide)) {
      ctx.save();
      ctx.setLineDash([3.4, 4.2]);
      ctx.strokeStyle = color.outline; ctx.lineWidth = 1.25; ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(tank.x, tank.y);
    if (tank.invulnerable === true && (state.phase == null || state.phase === 'playing')) {
      ctx.beginPath();
      ctx.arc(0, 0, 17 * tankScale, 0, Math.PI * 2);
      ctx.strokeStyle = '#ac7b23';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    ctx.rotate(Number.isFinite(tank.angle) ? tank.angle : 0);
    ctx.scale(tankScale, tankScale);
    stageTankGlyph(ctx, color);
    ctx.restore();
    if (Object.hasOwn(squadColors, squad)) {
      const badgeY = tank.y > state.height - 30 ? tank.y - 24 * tankScale : tank.y + 18 * tankScale;
      const badgeX = Math.max(7, Math.min(state.width - 7, tank.x));
      ctx.save();
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = squadColors[squad];
      ctx.fillRect(badgeX - 6, badgeY - 8, 12, 11);
      ctx.fillStyle = '#fff';
      ctx.fillText(squadLetter(squad), badgeX, badgeY);
      ctx.restore();
    }

  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, state.width, state.height);
  ctx.clip();
  for (const bullet of state.bullets) {
    if (!pointIsValid(bullet)) continue;
    const size = bullet.kind === 'frag' ? 4.1 : bullet.kind === 'gatling' ? gatlingRadius
      : bullet.kind === 'shrapnel' ? shrapnelRadius : shellRadius;
    const owner = bullet.owner;
    const color = teamForOwner(state, mode, owner);
    const squad = teams[owner];
    const outline = Object.hasOwn(squadColors, squad) ? squadColors[squad] : color.outline;
    if (bullet.kind === 'laser' && drawLaserTrail(ctx, bullet.path, color, outline)) continue;
    const speed = Math.hypot(bullet.vx, bullet.vy);
    ctx.beginPath();
    if (['laser', 'missile', 'remote'].includes(bullet.kind) && Number.isFinite(speed) && speed > 0) {
      ctx.save();
      ctx.translate(bullet.x, bullet.y);
      ctx.rotate(Math.atan2(bullet.vy, bullet.vx));
      if (bullet.kind === 'laser') {
        ctx.moveTo(-7, 0); ctx.lineTo(2, 0);
        ctx.lineCap = 'round';
        ctx.strokeStyle = outline; ctx.lineWidth = 3.3; ctx.stroke();
        ctx.strokeStyle = color.turret; ctx.lineWidth = 1.6; ctx.stroke();
      } else {
        ctx.scale(missileScale, missileScale);
        ctx.moveTo(5, 0); ctx.lineTo(-4, -3); ctx.lineTo(-2, 0); ctx.lineTo(-4, 3); ctx.closePath();
        ctx.fillStyle = color.hull; ctx.fill();
        ctx.strokeStyle = outline; ctx.lineWidth = 1.1; ctx.stroke();
        if (bullet.kind === 'remote') {
          ctx.beginPath();
          ctx.arc(-1, 0, 1, 0, Math.PI * 2);
          ctx.fillStyle = color.turret; ctx.fill();
        }
      }
      ctx.restore();
    } else {
      const tiny = bullet.kind === 'gatling';
      ctx.arc(bullet.x, bullet.y, Math.max(size, (tiny ? 0.7 : 1) * ratio / scale), 0, Math.PI * 2);
      ctx.fillStyle = color.hull; ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = tiny ? 0.55 : Math.max(0.82, ratio * 0.6 / scale); ctx.stroke();
    }
  }
  drawEffects(ctx, state, effects, mode);
  drawLethalRings(ctx, state, mode, lethalRings);
  drawPickupFeedback(ctx, state, effects);
  ctx.restore();
}

export function drawScoreIcon(canvas, index, mode, id) {
  const { ctx, width, height } = fitCanvas(canvas);
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const scale = Math.min(width, height) / 29;
  ctx.setTransform(scale, 0, 0, scale, width / 2, height / 2);
  ctx.rotate(-Math.PI / 2);
  stageTankGlyph(ctx, team(index, mode, id));
}

export function drawWeaponIcon(canvas, weapon) {
  const { ctx, width, height } = fitCanvas(canvas);
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const scale = Math.min(width, height) / 17;
  ctx.setTransform(scale, 0, 0, scale, width / 2, height / 2);
  weaponGlyph(ctx, weapon);
}

const eventLabels = {
  shot: '开火', bounce: '弹丸反弹', hit: '命中', pickup: '取得道具',
  'pickup-blocked': '已有武器，未拾取', 'pickup-spawn': '道具刷新', 'shell-expired': '弹丸消失', 'shot-blocked': '未能开火',
  'wall-stop': '撞墙', 'tank-stop': '坦克碰撞', destroyed: '击毁', ended: '对局结束',
  timeout: '动作超时', 'weapon-fired': '使用武器', 'frag-burst': '破片炸开',
  'weapon-charge': '武器蓄力', 'last-tank-pending': '等待炮火结算', 'mine-placed': '埋设地雷', 'mine-burst': '地雷爆炸', 'round-start': '开局',
  'round-end': '本局结束', 'death-ray-beam': '死光光束', 'laser-path': '激光轨迹', 'mine-activated': '地雷激活', 'mine-trigger': '地雷开始倒计时', 'zone-eliminated': '安全区外淘汰',
};

export function formatTankEvent(event, displayPlayer = (id) => id) {
  const type = event.type || '事件';
  const kind = eventLabels[type] ?? type;
  const hit = type === 'hit' || type === 'destroyed';
  const actor = event.playerId ?? event.ownerId ?? (hit ? null : event.tankId);
  const target = hit ? event.tankId : null;
  const shell = event.bulletId;
  const position = Number.isFinite(event.x) && Number.isFinite(event.y)
    ? `(${event.x.toFixed(1)}, ${event.y.toFixed(1)})` : null;
  const weapon = event.pickupType ?? event.weapon ?? (Object.hasOwn(weapons, event.kind) ? event.kind : null);
  const labels = [kind, event.round == null ? null : `第 ${event.round} 局`,
    actor == null ? null : `选手 ${displayPlayer(actor)}`, target == null ? null : `目标 ${displayPlayer(target)}`,
    shell == null ? null : `弹丸 ${shell}`, weapon == null ? null : weapons[weapon] ?? weapon,
    event.winnerTeam != null ? `队伍 ${squadLetter(event.winnerTeam)} 获胜` : event.winner == null ? null : `选手 ${displayPlayer(event.winner)} 获胜`,
    position];
  return labels.filter(Boolean).join(' · ');
}
