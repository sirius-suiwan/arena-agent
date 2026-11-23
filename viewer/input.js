const modes = Object.freeze({
  human: { label: '人机对战', help: 'A：方向键或 WASD 移动，M 或空格开火。' },
  bots: { label: 'Bot 对战' },
  local2: { label: '双人同屏', help: 'A：方向键移动，M 或空格开火。　B：ESDF 移动，Q 开火。' },
  local3: { label: '三人同屏', help: 'A：方向键移动，M 或空格开火。　B：ESDF 移动，Q 开火。　C：移动鼠标转向并前进，点击开火。' },
});

export function matchMode(mode) {
  return Object.hasOwn(modes, mode) ? modes[mode] : null;
}

const arrows = [['ArrowUp'], ['ArrowDown'], ['ArrowRight'], ['ArrowLeft'], ['KeyM', 'Space']];
const single = arrows.map((keys, i) => i < 4 ? [...keys, ['KeyW', 'KeyS', 'KeyD', 'KeyA'][i]] : keys);
const second = [['KeyE'], ['KeyD'], ['KeyF'], ['KeyS'], ['KeyQ']];

function controls(mode) {
  if (mode === 'human') return { A: single };
  if (mode === 'local2' || mode === 'local3') return { A: arrows, B: second };
  return {};
}

const axis = (plus, minus, has) => Number(plus.some(has)) - Number(minus.some(has));

export function keyboardAction(mode, id, held) {
  const keys = controls(mode)[id];
  if (!keys) return null;
  const [forward, backward, right, left, fire] = keys;
  const has = (key) => held.has(key);
  return { throttle: axis(forward, backward, has), turn: axis(right, left, has), fire: fire.some(has) };
}

export function keySeat(mode, code) {
  return Object.entries(controls(mode)).find(([, bindings]) =>
    bindings.some((keys) => keys.includes(code)))?.[0] ?? null;
}

const angleError = (target, current) => Math.atan2(Math.sin(target - current), Math.cos(target - current));

/** Player C's pointer adapter creates ordinary steering intents, not teleportation or direct position changes. */
export function pointerAction(tank, target, fire = false) {
  if (!tank || tank.alive === false || !target) return { throttle: 0, turn: 0, fire };
  const dx = target.x - tank.x, dy = target.y - tank.y;
  if (Math.hypot(dx, dy) < 6) return { throttle: 0, turn: 0, fire };
  const error = angleError(Math.atan2(dy, dx), tank.angle);
  return {
    throttle: Math.abs(error) < 0.68 ? 1 : 0,
    turn: Math.abs(error) < 0.065 ? 0 : Math.sign(error),
    fire,
  };
}
