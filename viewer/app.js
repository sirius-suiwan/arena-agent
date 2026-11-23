import { renderers } from './renderers.js';
import { matchMode, keyboardAction, keySeat, pointerAction } from './input.js';

const byId = (id) => document.getElementById(id);
const el = Object.fromEntries([
  'battle', 'mode-label', 'match-form', 'seed', 'back-live', 'replay-file',
  'status', 'error', 'frame-label', 'empty', 'human-help', 'timeline-panel',
  'scoreboard', 'round-label', 'round-notice',
  'timeline', 'prev', 'play', 'next', 'event-count', 'event-hint', 'event-list', 'action-details', 'frame-actions',
].map((id) => [id, byId(id)]));

const blank = () => ({ manifest: null, frames: [], events: [], totalEvents: 0, result: null, done: false });
let live = blank();
let replay = null;
let frameIndex = 0;
let playback = null;
let requestedMode = null;
let starting = false;
let streamOpen = false;
let drawPending = false;
let eventRowsDirty = true;
let importSequence = 0;
let inputEpoch = 0;
let scoreKey = '';
const heldKeys = new Set();
const inputChains = new Map();
const lastInput = new Map();
let pointerTarget = null;
let pointerPressed = false;
const neutral = { throttle: 0, turn: 0, fire: false };
function tickOf(record) {
  return record.state?.tick ?? record.tick ?? 0;
}

function appendTick(match, record) {
  const index = match.frames.length;
  const actions = record.input && Object.fromEntries(Object.entries(record.input).map(([id, entry]) => [
    id, entry?.fallback == null ? entry?.accepted : { action: entry.accepted, fallback: entry.fallback },
  ]));
  const frameEvents = Array.isArray(record.events) ? record.events.filter((e) => e && typeof e === 'object') : [];
  match.frames.push({ tick: tickOf(record), state: record.state, actions, events: frameEvents });
  for (const event of frameEvents) {
    match.events.push({ index, tick: tickOf(record), event });
    match.totalEvents++;
  }
}

function setStatus(text) {
  if (el.status.textContent !== text) el.status.textContent = text;
}

function setError(message) {
  el.error.hidden = !message;
  el.error.textContent = message || '';
}

function outcome(result) {
  if (!result || typeof result !== 'object') return '结果未记录';
  const reason = result.reason;
  const reasonText = ({ 'last-tank': '场上最后一辆坦克', timeout: '达到时间上限', tick_limit: '达到时间上限', 'double-knockout': '同时被击毁', 'score-target': '达到目标分数', 'score-limit': '达到目标分数', 'round-limit': '达到局数上限' })[reason] ?? reason;
  const winner = result.winner == null ? '平局' : `选手 ${result.winner} 获胜`;
  return reasonText ? `${winner}（${reasonText}）` : winner;
}

function renderEvents(match, isReplay) {
  if (!eventRowsDirty) return;
  eventRowsDirty = false;
  const limit = 100;
  const first = isReplay
    ? nearestEventIndex(match.events, frameIndex, limit) : Math.max(0, match.events.length - limit);
  const last = Math.min(match.events.length, first + limit);
  el['event-count'].textContent = `${match.totalEvents} 条`;
  el['event-hint'].textContent = isReplay
    ? `显示时间轴附近的 ${last - first} 条事件，选择一条即可跳转。`
    : `显示最近的 ${last - first} 条裁判事件。`;
  const formatEvent = rendererFor(match.manifest)?.formatEvent ?? ((event) => event.type || '事件');
  const items = document.createDocumentFragment();
  for (const row of match.events.slice(first, last)) {
    const li = document.createElement('li');
    const entry = document.createElement(isReplay ? 'button' : 'span');
    if (isReplay) {
      entry.type = 'button';
      entry.addEventListener('click', () => {
        stopPlayback();
        seek(row.index);
      });
      if (row.index === frameIndex) entry.setAttribute('aria-current', 'true');
    } else entry.className = 'event-text';
    const label = document.createElement('span');
    label.className = 'event-tick';
    label.textContent = `#${row.tick}`;
    entry.append(label, document.createTextNode(formatEvent(row.event)));
    li.append(entry);
    items.append(li);
  }
  el['event-list'].replaceChildren(items);
}

function nearestEventIndex(events, index, limit) {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const middle = (lo + hi) >>> 1;
    if (events[middle].index < index) lo = middle + 1;
    else hi = middle;
  }
  return Math.max(0, Math.min(lo - Math.floor(limit / 2), events.length - limit));
}

function effectsAt(frames, index) {
  const effects = [];
  const now = tickOf(frames[index]);
  const round = frames[index].state?.round;
  for (let i = index; i >= 0 && now - tickOf(frames[i]) < 10; i--) {
    if (frames[i].state?.round !== round) break;
    const age = now - tickOf(frames[i]);
    for (const event of frames[i].events) effects.push({ event, age });
  }
  return effects;
}

function renderScoreboard(match, state, renderer) {
  const ids = state?.tanks?.map((tank) => tank.id) ?? match.manifest?.players ?? [];
  const scores = ids.map((id) => state?.scores?.[id] ?? (state?.result?.winner === id ? 1 : 0));
  const key = JSON.stringify([match.manifest?.mode, ids, scores, renderer?.title]);
  if (scoreKey !== key) {
    scoreKey = key;
    const icons = [];
    const items = document.createDocumentFragment();
    ids.forEach((id, index) => {
      const row = document.createElement('span');
      row.className = 'score';
      row.setAttribute('aria-label', `选手 ${id}：${scores[index]} 分`);
      const icon = document.createElement('canvas');
      icon.className = 'score-icon';
      icon.setAttribute('aria-hidden', 'true');
      icons.push(icon);
      const number = document.createElement('span');
      number.className = 'score-number';
      number.textContent = scores[index];
      const label = document.createElement('span');
      label.className = 'score-id';
      label.textContent = id;
      row.append(icon, number, label);
      items.append(row);
    });
    el.scoreboard.replaceChildren(items);
    icons.forEach((icon, index) => renderer?.scoreIcon?.(icon, index, match.manifest?.mode));
  }
  const round = state?.round ?? 1;
  el['round-label'].textContent = Number.isSafeInteger(state?.targetScore)
    ? `第 ${round} 局 · 先到 ${state.targetScore} 分` : `第 ${round} 局`;
  const notice = el['round-notice'];
  if (state?.phase === 'intermission') {
    notice.hidden = false;
    notice.textContent = state.roundWinner == null ? '本局平局' : `选手 ${state.roundWinner} 拿下本局`;
  } else if (state?.phase === 'finished' && state.result) {
    notice.hidden = false;
    notice.textContent = outcome(state.result);
  } else notice.hidden = true;
}

function render() {
  drawPending = false;
  const match = replay ?? live;
  const current = replay ? frameIndex : match.frames.length - 1;
  const record = match.frames[current];
  const hasFrames = Boolean(record?.state);
  const matchActive = Boolean(live.manifest) && !live.done;
  const mode = matchMode(live.manifest?.mode);
  const help = !replay && matchActive && mode?.help;
  el['mode-label'].textContent = replay ? '离线回放' : mode?.label ?? '实时观战';
  el['frame-label'].textContent = `TICK ${record ? tickOf(record) : 0}`;
  el.empty.hidden = hasFrames;
  el['human-help'].hidden = !help;
  el['human-help'].textContent = help || '';
  el.battle.classList.toggle('pointer-control', activeMode() === 'local3');
  el['back-live'].hidden = !replay;
  el['timeline-panel'].hidden = !replay;
  for (const button of el['match-form'].querySelectorAll('button')) button.disabled = starting || matchActive;
  if (replay) {
    el.timeline.max = String(Math.max(0, match.frames.length - 1));
    el.timeline.value = String(frameIndex);
    el.timeline.setAttribute('aria-valuetext', `Tick ${record ? tickOf(record) : 0}`);
    el.prev.disabled = frameIndex === 0;
    el.next.disabled = frameIndex >= match.frames.length - 1;
    el.play.textContent = playback ? '暂停' : '播放';
  }
  if (el['action-details'].open) {
    el['frame-actions'].textContent = record?.actions
      ? JSON.stringify(record.actions, null, 2) : '本帧无选手动作。';
  }
  const renderer = rendererFor(match.manifest);
  if (renderer && record) {
    el.battle.setAttribute('aria-label', renderer.title);
    renderer.draw(el.battle, record.state, {
      mode: match.manifest?.mode,
      effects: effectsAt(match.frames, current),
    });
  } else {
    el.battle.getContext('2d')?.clearRect(0, 0, el.battle.width, el.battle.height);
  }
  renderScoreboard(match, record?.state, renderer);
  renderEvents(match, Boolean(replay));
}

function queueDraw(updateEvents = false) {
  if (updateEvents) eventRowsDirty = true;
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(render);
}

function liveStatus() {
  if (replay) return;
  if (live.done) {
    setStatus(live.result ? `对局结束：${outcome(live.result)}。` : '对局已结束。');
  } else if (live.manifest) {
    const seed = live.manifest.seed;
    setStatus(`${matchMode(live.manifest.mode)?.label ?? '对战'}进行中${seed == null ? '' : `，种子 ${seed}`}。`);
  } else {
    setStatus(starting ? '正在启动对局…' : '等待开局，或打开已有的回放。');
  }
}

function seek(index) {
  if (!replay) return;
  frameIndex = Math.max(0, Math.min(replay.frames.length - 1, index));
  queueDraw(true);
}

function stopPlayback() {
  if (playback) cancelAnimationFrame(playback.request);
  playback = null;
  queueDraw();
}

function play() {
  if (!replay || replay.frames.length < 2) return;
  if (playback) return stopPlayback();
  if (frameIndex === replay.frames.length - 1) seek(0);
  const startTick = tickOf(replay.frames[frameIndex]);
  const rate = Number(replay.manifest.tickRate);
  const tickRate = Number.isFinite(rate) && rate > 0 ? rate : 60;
  playback = { request: 0, startMs: performance.now() };
  const nextFrame = (now) => {
    if (!playback || !replay) return;
    const targetTick = startTick + (now - playback.startMs) * tickRate / 1000;
    let index = frameIndex;
    while (index + 1 < replay.frames.length && tickOf(replay.frames[index + 1]) <= targetTick) index++;
    if (index !== frameIndex) seek(index);
    if (index + 1 === replay.frames.length) return stopPlayback();
    playback.request = requestAnimationFrame(nextFrame);
  };
  playback.request = requestAnimationFrame(nextFrame);
  queueDraw();
}

function reduceLive(record) {
  if (record.type === 'start' && record.state) {
    inputEpoch++;
    resetInput();
    live = blank();
    live.manifest = { ...record.manifest, mode: record.manifest?.mode ?? requestedMode };
    appendTick(live, record);
    if (!replay) setError('');
  } else if (record.type === 'tick' && record.state && live.manifest && !live.done) {
    if (tickOf(record) <= tickOf(live.frames.at(-1))) return;
    // Keep a small recent history so transient effects render the same way as replay.
    appendTick(live, record);
    if (live.frames.length > 10) live.frames.shift();
    updatePointer();
    if (live.events.length > 100) live.events = live.events.slice(-100);
  } else if (record.type === 'end' || record.type === 'error') {
    resetInput();
    inputEpoch++;
    live.done = true;
    live.result = record.result ?? null;
    if (record.type === 'error' && !replay) setError(record.message || '裁判报告运行失败。');
  } else return;
  liveStatus();
  if (!replay) queueDraw(record.type !== 'tick' || record.events?.length > 0);
}

const events = new EventSource('/api/events');
events.onopen = () => {
  streamOpen = true;
  if (!replay && !starting) {
    liveStatus();
  }
};
events.onerror = () => {
  streamOpen = false;
  releaseInput();
  if (!replay) setStatus('观战连接中断，浏览器正在重连。');
};
events.onmessage = (message) => {
  try {
    reduceLive(JSON.parse(message.data));
  } catch {
    if (!replay) setError('收到无法读取的观战数据。');
  }
};

async function post(route, body, timeout = 5000) {
  const response = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message ?? data?.error ?? `HTTP ${response.status}`);
  }
}

el['match-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  if (starting || (live.manifest && !live.done)) return;
  if (!streamOpen) return setError('尚未连到裁判，请稍后重试。');
  const requested = event.submitter?.value;
  const mode = matchMode(requested) ? requested : 'human';
  const seed = Number(el.seed.value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return setError('种子必须是有效的非负整数。');
  importSequence++;
  stopPlayback();
  replay = null;
  starting = true;
  requestedMode = mode;
  setError('');
  setStatus('正在启动对局…');
  queueDraw(true);
  try {
    await post('/api/match', { mode, seed });
  } catch (error) {
    if (!replay) setError(`开局失败：${error.message}`);
  } finally {
    starting = false;
    liveStatus();
    queueDraw();
  }
});

function rendererFor(manifest) {
  const game = manifest?.game ?? manifest?.gameId;
  return Object.hasOwn(renderers, game) ? renderers[game] : null;
}

function validateFrame(record, manifest) {
  return Number.isSafeInteger(tickOf(record)) && tickOf(record) >= 0
    && rendererFor(manifest)?.validate(record.state);
}

async function readReplay(file, stillCurrent) {
  const candidate = blank();
  const decoder = new TextDecoderStream();
  const reader = file.stream().pipeThrough(decoder).getReader();
  let content = '';
  let number = 0;
  const parseLine = (line) => {
    number++;
    if (!line.trim()) return;
    let record;
    try { record = JSON.parse(line); } catch { throw new Error(`第 ${number} 行不是有效 JSON。`); }
    if (!record || typeof record !== 'object') throw new Error(`第 ${number} 行不是对局记录。`);
    if (candidate.done) throw new Error(`第 ${number} 行在结束记录之后。`);
    if (record.type === 'start' && !candidate.manifest) {
      candidate.manifest = record.manifest;
      if (!rendererFor(candidate.manifest)) throw new Error('这个游戏还没有可用的画面渲染器。');
      if (!validateFrame(record, candidate.manifest)) throw new Error('开局帧结构不完整。');
      appendTick(candidate, record);
    } else if (record.type === 'tick' && candidate.manifest && validateFrame(record, candidate.manifest)
        && tickOf(record) > tickOf(candidate.frames.at(-1))) {
      appendTick(candidate, record);
    } else if (record.type === 'end' && candidate.manifest) {
      candidate.done = true;
      candidate.result = record.result ?? null;
    } else {
      throw new Error(`第 ${number} 行的记录类型、帧结构或 tick 顺序不匹配。`);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (!stillCurrent()) return null;
      if (done) break;
      const lines = (content + value).split('\n');
      content = lines.pop();
      if (content.length > 4_000_000) throw new Error('回放中存在过长的单行记录。');
      for (const line of lines) parseLine(line);
    }
    if (content) parseLine(content);
    if (!candidate.frames.length) throw new Error('未找到有效的对局帧。');
    return candidate;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

el['replay-file'].addEventListener('change', async () => {
  const file = el['replay-file'].files?.[0];
  el['replay-file'].value = '';
  if (!file) return;
  const importId = ++importSequence;
  stopPlayback();
  releaseInput();
  setStatus('正在读取回放…');
  setError('');
  try {
    const candidate = await readReplay(file, () => importId === importSequence);
    if (!candidate || importId !== importSequence) return;
    replay = candidate;
    frameIndex = 0;
    setStatus(candidate.done ? `回放：${outcome(candidate.result)}。` : '已打开记录，未找到结束行。');
    queueDraw(true);
  } catch (error) {
    if (importId !== importSequence) return;
    setError(`打开回放失败：${error.message}`);
    if (replay) setStatus('继续显示上一份回放。');
    else liveStatus();
  }
});

el['back-live'].addEventListener('click', () => {
  importSequence++;
  stopPlayback();
  replay = null;
  setError('');
  liveStatus();
  queueDraw(true);
});
el.timeline.addEventListener('input', () => {
  stopPlayback();
  seek(Number(el.timeline.value));
});
el.prev.addEventListener('click', () => { stopPlayback(); seek(frameIndex - 1); });
el.next.addEventListener('click', () => { stopPlayback(); seek(frameIndex + 1); });
el.play.addEventListener('click', play);
el['action-details'].addEventListener('toggle', () => queueDraw());

function activeMode() {
  return !replay && !live.done ? live.manifest?.mode : null;
}

function resetInput() {
  heldKeys.clear();
  pointerTarget = null;
  pointerPressed = false;
  lastInput.clear();
  inputChains.clear();
}

function sendInput(playerId, action) {
  const epoch = inputEpoch;
  const previous = lastInput.get(playerId);
  if (previous?.throttle === action.throttle && previous.turn === action.turn && previous.fire === action.fire) return;
  lastInput.set(playerId, action);
  const pending = (inputChains.get(playerId) ?? Promise.resolve()).then(async () => {
    if (epoch !== inputEpoch || live.done) return;
    await post('/api/input', { playerId, ...action }, 1000);
  }).catch(() => {
    if (lastInput.get(playerId) === action) lastInput.delete(playerId);
    if (activeMode()) setError('输入未送达裁判。');
  });
  inputChains.set(playerId, pending);
}

function updatePointer() {
  if (activeMode() !== 'local3' || (!pointerTarget && !pointerPressed && !lastInput.has('C'))) return;
  const state = live.frames.at(-1)?.state;
  const tank = state?.tanks?.find(({ id }) => id === 'C');
  sendInput('C', pointerAction(tank, pointerTarget, pointerPressed));
}

function setPointerTarget(event) {
  const state = live.frames.at(-1)?.state;
  const renderer = rendererFor(live.manifest);
  pointerTarget = renderer?.projectPointer?.(el.battle, state, event.clientX, event.clientY) ?? null;
}

function releaseInput() {
  heldKeys.clear();
  pointerTarget = null;
  pointerPressed = false;
  for (const id of lastInput.keys()) sendInput(id, neutral);
}

el.battle.addEventListener('pointermove', (event) => {
  if (activeMode() !== 'local3') return;
  setPointerTarget(event);
  updatePointer();
});
el.battle.addEventListener('pointerdown', (event) => {
  if (activeMode() !== 'local3' || event.button !== 0) return;
  event.preventDefault();
  el.battle.setPointerCapture?.(event.pointerId);
  setPointerTarget(event);
  pointerPressed = true;
  updatePointer();
});
el.battle.addEventListener('pointerup', (event) => {
  if (activeMode() !== 'local3' || event.button !== 0) return;
  pointerPressed = false;
  updatePointer();
});
for (const name of ['pointerleave', 'pointercancel']) {
  el.battle.addEventListener(name, () => {
    if (activeMode() !== 'local3') return;
    pointerTarget = null;
    pointerPressed = false;
    updatePointer();
  });
}
addEventListener('keydown', (event) => {
  const mode = activeMode();
  const seat = keySeat(mode, event.code);
  if (!seat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target?.closest?.('input, select, textarea, [contenteditable]')) return;
  if (event.code === 'Space' && event.target?.closest?.('button, a')) return;
  event.preventDefault();
  if (heldKeys.has(event.code)) return;
  heldKeys.add(event.code);
  sendInput(seat, keyboardAction(mode, seat, heldKeys));
});
addEventListener('keyup', (event) => {
  if (!heldKeys.delete(event.code)) return;
  event.preventDefault();
  const mode = activeMode();
  const seat = keySeat(mode, event.code);
  if (seat) sendInput(seat, keyboardAction(mode, seat, heldKeys));
});
addEventListener('blur', releaseInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseInput(); });
new ResizeObserver(() => queueDraw()).observe(el.battle);
queueDraw();
