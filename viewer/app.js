import { renderers } from './renderers.js';
import { indexLethalProjectiles, lethalProjectileRings } from './replay-highlight.js';
import { matchMode, keyboardAction, keySeat, pointerAction } from './input.js';

const byId = (id) => document.getElementById(id);
const el = Object.fromEntries([
  'battle', 'mode-label', 'match-form', 'seed', 'back-live', 'replay-file',
  'status', 'error', 'frame-label', 'time-label', 'human-help', 'timeline-panel',
  'match-id', 'match-id-value', 'match-id-copy',
  'match-controls', 'stop-match', 'play-replay', 'stop-replay', 'details', 'menu', 'stage', 'return-menu', 'continue-match',
  'scoreboard', 'round-label', 'round-notice', 'canvas-wrap',
  'kill-panel', 'kill-markers', 'kill-status',
  'seat-name-A', 'seat-name-B', 'seat-name-C',
  'timeline', 'prev', 'next', 'event-count', 'event-hint', 'event-list', 'frame-actions',
].map((id) => [id, byId(id)]));

const blank = () => ({ manifest: null, frames: [], events: [], totalEvents: 0, result: null, done: false });
let live = blank();
let replay = null;
let selectedKill = null;
let markerSource = null;
let markerButtons = new Map();
let frameIndex = 0;
let playback = null;
let requestedMode = null;
let starting = false;
let stopRequest = null;
let menuVisible = true;
let streamOpen = false;
let drawPending = false;
let eventRowsDirty = true;
let importSequence = 0;
let inputEpoch = 0;
let scoreKey = '';
let fieldRatio = '';
const WEAPON_FEEDBACK_TICKS = 60;
const MAX_SEAT_NAME_LENGTH = 24;
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

function tidyName(value) {
  return value.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '').trim().replace(/\s+/gu, ' ');
}

function playerName(manifest, id) {
  const names = manifest?.playerNames;
  const value = names && Object.hasOwn(names, id) ? names[id] : null;
  if (typeof value !== 'string') return id;
  const trimmed = tidyName(value);
  return trimmed && Array.from(trimmed).length <= MAX_SEAT_NAME_LENGTH ? trimmed : id;
}

function playerLabel(manifest, id) {
  const name = playerName(manifest, id);
  return name === id ? id : `${name}（${id}）`;
}

function outcome(result, manifest) {
  if (!result || typeof result !== 'object') return '结果未记录';
  const reason = result.reason;
  if (reason === 'stopped') return '已停止';
  const reasonText = ({ 'last-tank': '场上最后一辆坦克', timeout: '达到时间上限', tick_limit: '达到时间上限', 'double-knockout': '同时被击毁', 'score-target': '达到目标分数', 'score-limit': '达到目标分数', 'round-limit': '达到局数上限' })[reason] ?? reason;
  const winner = result.winner == null ? '平局' : `选手 ${playerLabel(manifest, result.winner)} 获胜`;
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
      if (row.event.type === 'destroyed') {
        entry.classList.add('kill-event');
        entry.title = '跳至击毁，并高亮致命弹道';
      }
      entry.addEventListener('click', () => {
        stopPlayback();
        seek(row.index, row.event.type === 'destroyed' ? row : null);
      });
      if (row.index === frameIndex) entry.setAttribute('aria-current', 'true');
    } else entry.className = 'event-text';
    const label = document.createElement('span');
    label.className = 'event-tick';
    label.textContent = `#${row.tick}`;
    entry.append(label, document.createTextNode(formatEvent(row.event, (id) => playerLabel(match.manifest, id))));
    li.append(entry);
    items.append(li);
  }
  el['event-list'].replaceChildren(items);
}

function renderKillMarkers() {
  const panel = el['kill-panel'];
  if (!replay) { panel.hidden = true; return; }
  if (markerSource !== replay) {
    markerSource = replay;
    markerButtons = new Map();
    const items = document.createDocumentFragment();
    for (const row of replay.events) {
      const event = row.event;
      if (event.type !== 'destroyed') continue;
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const ownerId = event.ownerId ?? event.owner;
      const victim = playerLabel(replay.manifest, event.tankId ?? event.targetId ?? '？');
      const owner = ownerId == null ? '？' : playerLabel(replay.manifest, ownerId);
      button.textContent = `#${row.tick} ${owner} → ${victim}`;
      button.addEventListener('click', () => { stopPlayback(); seek(row.index, row); });
      markerButtons.set(row, button);
      item.append(button);
      items.append(item);
    }
    el['kill-markers'].replaceChildren(items);
  }
  panel.hidden = markerButtons.size === 0;
  for (const [row, button] of markerButtons) {
    button.setAttribute('aria-pressed', String(row === selectedKill?.row));
  }
  const status = el['kill-status'];
  status.hidden = !selectedKill;
  if (selectedKill) {
    const event = selectedKill.row.event;
    status.textContent = event.ownerId != null && event.ownerId === (event.tankId ?? event.targetId)
      ? '这次击毁是自伤。' : '已跳到击毁时刻。';
  }
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
  for (let i = index; i >= 0 && now - tickOf(frames[i]) < WEAPON_FEEDBACK_TICKS; i--) {
    if (frames[i].state?.round !== round) break;
    const age = now - tickOf(frames[i]);
    for (const event of frames[i].events) {
      if (age < 10 || event.type === 'pickup' || event.type === 'pickup-blocked') effects.push({ event, age });
    }
  }
  return effects;
}

function renderScoreboard(match, state, renderer) {
  const ids = state?.tanks?.map((tank) => tank.id) ?? match.manifest?.players ?? [];
  const scores = ids.map((id) => state?.scores?.[id] ?? (state?.result?.winner === id ? 1 : 0));
  const equipment = ids.map((id) => renderer?.equippedWeapon?.(state?.tanks.find((tank) => tank.id === id), state) ?? null);
  const names = ids.map((id) => playerName(match.manifest, id));
  const key = JSON.stringify([match.manifest?.mode, ids, names, scores, equipment, renderer?.title]);
  if (scoreKey !== key) {
    scoreKey = key;
    const icons = [];
    const weapons = [];
    const items = document.createDocumentFragment();
    ids.forEach((id, index) => {
      const row = document.createElement('span');
      row.className = 'score';
      const weapon = equipment[index];
      const weaponLabel = weapon && renderer?.weaponLabel?.(weapon);
      const name = names[index];
      const player = playerLabel(match.manifest, id);
      row.setAttribute('aria-label', `选手 ${player}：${scores[index]} 分${weaponLabel ? `，已装备${weaponLabel}` : ''}`);
      row.title = player;
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
      row.append(icon, number);
      if (name !== id) {
        const nameLabel = document.createElement('span');
        nameLabel.className = 'score-name';
        nameLabel.textContent = name;
        nameLabel.dir = 'auto';
        row.append(nameLabel);
      }
      row.append(label);
      if (weaponLabel) {
        const badge = document.createElement('canvas');
        badge.className = 'weapon-badge';
        badge.title = `已装备${weaponLabel}`;
        badge.setAttribute('aria-hidden', 'true');
        weapons.push([badge, weapon]);
        row.append(badge);
      }
      items.append(row);
    });
    el.scoreboard.replaceChildren(items);
    icons.forEach((icon, index) => renderer?.scoreIcon?.(icon, index, match.manifest?.mode));
    for (const [icon, weapon] of weapons) renderer?.weaponIcon?.(icon, weapon);
  }
  const round = state?.round ?? 1;
  el['round-label'].textContent = Number.isSafeInteger(state?.targetScore)
    ? `第 ${round} 局 · 先到 ${state.targetScore} 分` : `第 ${round} 局`;
  const notice = el['round-notice'];
  if (match.done && match.result?.reason === 'stopped' && (!replay || frameIndex === match.frames.length - 1)) {
    notice.hidden = false;
    notice.textContent = '已停止';
  } else if (state?.phase === 'intermission') {
    notice.hidden = false;
    notice.textContent = state.roundWinner == null ? '本局平局' : `选手 ${playerLabel(match.manifest, state.roundWinner)} 拿下本局`;
  } else if (state?.phase === 'finished' && state.result) {
    notice.hidden = false;
    notice.textContent = outcome(state.result, match.manifest);
  } else if (match.done && match.result && (!replay || frameIndex === match.frames.length - 1)) {
    notice.hidden = false;
    notice.textContent = outcome(match.result, match.manifest);
  } else notice.hidden = true;
}

function elapsedLabel(tick, nominalRate) {
  const rate = Number.isFinite(nominalRate) && nominalRate > 0 ? nominalRate : 60;
  const seconds = Math.floor(tick / rate);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `对局时间 ${mm}:${ss}`;
}

function renderMatchId(manifest) {
  const id = manifest?.matchId;
  const valid = typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
  el['match-id'].hidden = menuVisible || !valid;
  const text = valid ? id : '';
  if (el['match-id-value'].textContent !== text) {
    el['match-id-value'].textContent = text;
    el['match-id-copy'].textContent = '复制';
    el['match-id'].title = valid ? `复制完整对局 ID（runs/<game-id>/${id}/）` : '';
  }
}

el['match-id'].addEventListener('click', async () => {
  const value = el['match-id-value'];
  const id = value.textContent;
  if (!id) return;
  try {
    await navigator.clipboard.writeText(id);
    if (value.textContent === id) el['match-id-copy'].textContent = '已复制';
  } catch {
    if (value.textContent !== id || el['match-id'].hidden) return;
    const selection = document.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(value);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    el['match-id-copy'].textContent = selection ? '已选中，可手动复制' : '无法自动复制';
  }
});

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
  const frame = hasFrames ? tickOf(record) : 0;
  el['frame-label'].textContent = `TICK ${frame}`;
  el['time-label'].textContent = elapsedLabel(frame, match.manifest?.tickRate);
  el.menu.hidden = !menuVisible;
  el.stage.hidden = menuVisible;
  renderMatchId(match.manifest);
  el['return-menu'].hidden = menuVisible;
  el['continue-match'].hidden = !live.manifest && !replay;
  el['continue-match'].textContent = replay ? '返回回放' : '返回对局';
  const canStopLive = !menuVisible && !replay && matchActive && typeof live.manifest.matchId === 'string';
  const canPlayReplay = !menuVisible && replay?.frames.length > 1;
  const canStopReplay = canPlayReplay && (Boolean(playback) || frameIndex > 0);
  const stopping = Boolean(stopRequest && stopRequest.matchId === live.manifest?.matchId);
  el['match-controls'].hidden = !canStopLive && !canPlayReplay;
  el['stop-match'].hidden = !canStopLive;
  el['stop-match'].disabled = stopping || !streamOpen || starting;
  el['stop-match'].textContent = stopping ? '停止中…' : '停止对局';
  el['play-replay'].hidden = !canPlayReplay;
  el['play-replay'].disabled = Boolean(playback);
  el['play-replay'].textContent = frameIndex === replay?.frames.length - 1 ? '重播' : '播放回放';
  el['stop-replay'].hidden = !canStopReplay;
  el['human-help'].hidden = !help;
  el['human-help'].textContent = help || '';
  el.battle.classList.toggle('pointer-control', activeMode() === 'local3');
  el['back-live'].hidden = !replay;
  el['timeline-panel'].hidden = !replay;
  for (const button of el['match-form'].querySelectorAll('button')) button.disabled = starting || matchActive;
  el.seed.disabled = starting || matchActive;
  if (replay) {
    el.timeline.max = String(Math.max(0, match.frames.length - 1));
    el.timeline.value = String(frameIndex);
    el.timeline.setAttribute('aria-valuetext', `Tick ${record ? tickOf(record) : 0}`);
    el.prev.disabled = frameIndex === 0;
    el.next.disabled = frameIndex >= match.frames.length - 1;
  }
  if (el.details.open) {
    el['frame-actions'].textContent = record?.actions
      ? JSON.stringify(record.actions, null, 2) : '本帧无选手动作。';
  }
  const renderer = rendererFor(match.manifest);
  if (!menuVisible && renderer && record) {
    const ratio = String(record.state.width / record.state.height);
    if (ratio !== fieldRatio && Number.isFinite(Number(ratio)) && Number(ratio) > 0) {
      fieldRatio = ratio;
      el['canvas-wrap'].style.setProperty('--field-ratio', ratio);
    }
    el.battle.setAttribute('aria-label', renderer.title);
    renderer.draw(el.battle, record.state, {
      mode: match.manifest?.mode,
      effects: effectsAt(match.frames, current),
      lethalRings: replay ? lethalProjectileRings(replay.lethalIndex, record, current) : [],
    });
  } else if (!menuVisible) {
    el.battle.getContext('2d')?.clearRect(0, 0, el.battle.width, el.battle.height);
  }
  if (!menuVisible) renderScoreboard(match, record?.state, renderer);
  if (el.details.open) {
    renderEvents(match, Boolean(replay));
    renderKillMarkers();
  }
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
    setStatus(live.result?.reason === 'stopped' ? '对局已停止。'
      : live.result ? `对局结束：${outcome(live.result, live.manifest)}。` : '对局已结束。');
  } else if (live.manifest) {
    const seed = live.manifest.seed;
    setStatus(`${matchMode(live.manifest.mode)?.label ?? '对战'}进行中${seed == null ? '' : `，种子 ${seed}`}。`);
  } else {
    setStatus(starting ? '正在启动对局…' : '等待开局，或打开已有的回放。');
  }
}

function seek(index, killRow = null) {
  if (!replay) return;
  frameIndex = Math.max(0, Math.min(replay.frames.length - 1, index));
  selectedKill = killRow ? { row: killRow } : null;
  queueDraw(true);
}

function stopPlayback() {
  if (playback) cancelAnimationFrame(playback.request);
  playback = null;
  queueDraw();
}

function play() {
  if (!replay || replay.frames.length < 2) return;
  if (playback) return;
  if (frameIndex === replay.frames.length - 1) seek(0);
  selectedKill = null;
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

function finishLive(result) {
  resetInput();
  inputEpoch++;
  live.done = true;
  live.result = result ?? null;
}

function reduceLive(record) {
  if (record.type === 'start' && record.state) {
    inputEpoch++;
    resetInput();
    live = blank();
    live.manifest = { ...record.manifest, mode: record.manifest?.mode ?? requestedMode };
    appendTick(live, record);
    if (!replay) setError('');
  } else if (record.type === 'tick' && record.state && live.manifest && (!live.done || live.result?.reason === 'stopped')) {
    if (tickOf(record) <= tickOf(live.frames.at(-1))) return;
    // Keep a small recent history so transient effects render the same way as replay.
    appendTick(live, record);
    if (live.frames.length > WEAPON_FEEDBACK_TICKS) live.frames.shift();
    updatePointer();
    if (live.events.length > 100) live.events = live.events.slice(-100);
  } else if (record.type === 'end' || record.type === 'error') {
    finishLive(record.result);
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
  queueDraw();
};
events.onerror = () => {
  streamOpen = false;
  releaseInput();
  if (!replay) setStatus('观战连接中断，浏览器正在重连。');
  queueDraw();
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
  return response.json().catch(() => null);
}

el['play-replay'].addEventListener('click', play);
el['stop-replay'].addEventListener('click', () => {
  if (!replay) return;
  stopPlayback();
  seek(0);
});

el['stop-match'].addEventListener('click', async () => {
  const matchId = live.manifest?.matchId;
  if (replay || menuVisible || live.done || typeof matchId !== 'string' || stopRequest?.matchId === matchId || !streamOpen) return;
  const request = { matchId };
  stopRequest = request;
  el['stop-match'].disabled = true;
  inputEpoch++;
  resetInput();
  setError('');
  queueDraw();
  try {
    const response = await post('/api/stop', request);
    if (!live.done && live.manifest?.matchId === request.matchId) {
      if (response?.matchId !== request.matchId || !response.result) throw new Error('裁判未确认当前对局状态。');
      // The terminal SSE can race its HTTP acknowledgment. Accept remaining ticks
      // of this stopped match so the stage still reaches the last saved frame.
      finishLive(response.result);
    }
  } catch (error) {
    if (!replay && !live.done && live.manifest?.matchId === request.matchId) {
      for (const id of humanSeats(live.manifest.mode)) sendInput(id, neutral);
      setError(`无法停止对局：${error.message}`);
    }
  } finally {
    if (stopRequest === request) stopRequest = null;
    liveStatus();
    queueDraw();
  }
});

function humanSeats(mode) {
  return mode === 'local3' ? ['A', 'B', 'C'] : mode === 'local2' ? ['A', 'B'] : mode === 'human' ? ['A'] : [];
}

el['match-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  if (starting || (live.manifest && !live.done)) return;
  if (!streamOpen) return setError('尚未连到裁判，请稍后重试。');
  const requested = event.submitter?.value;
  const mode = matchMode(requested) ? requested : 'human';
  const seed = Number(el.seed.value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return setError('种子必须是有效的非负整数。');
  const seats = mode === 'local3' ? ['A', 'B', 'C'] : ['A', 'B'];
  const playerNames = {};
  for (const id of seats) {
    const name = tidyName(el[`seat-name-${id}`].value);
    if (Array.from(name).length > MAX_SEAT_NAME_LENGTH) {
      el.details.open = true;
      el[`seat-name-${id}`].focus();
      return setError(`坦克 ${id} 的名字最多 ${MAX_SEAT_NAME_LENGTH} 个字符。`);
    }
    if (name) playerNames[id] = name;
  }
  importSequence++;
  stopPlayback();
  replay = null;
  selectedKill = null;
  menuVisible = false;
  starting = true;
  requestedMode = mode;
  setError('');
  setStatus('正在启动对局…');
  queueDraw(true);
  try {
    await post('/api/match', { mode, seed, ...(Object.keys(playerNames).length ? { playerNames } : {}) });
  } catch (error) {
    if (!replay) {
      if (!live.manifest || live.done) menuVisible = true;
      setError(`开局失败：${error.message}`);
    }
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
    candidate.lethalIndex = indexLethalProjectiles(candidate.frames);
    replay = candidate;
    selectedKill = null;
      menuVisible = false;
    frameIndex = 0;
    setStatus(candidate.done ? `回放：${outcome(candidate.result, candidate.manifest)}。` : '已打开记录，未找到结束行。');
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
  selectedKill = null;
  menuVisible = !live.manifest;
  setError('');
  liveStatus();
  queueDraw(true);
});
el['return-menu'].addEventListener('click', () => {
  releaseInput();
  stopPlayback();
  menuVisible = true;
  queueDraw(true);
});
el['continue-match'].addEventListener('click', () => {
  menuVisible = false;
  queueDraw(true);
});
el.timeline.addEventListener('input', () => {
  stopPlayback();
  seek(Number(el.timeline.value));
});
el.prev.addEventListener('click', () => { stopPlayback(); seek(frameIndex - 1); });
el.next.addEventListener('click', () => { stopPlayback(); seek(frameIndex + 1); });
el.details.addEventListener('toggle', () => queueDraw(true));

function activeMode() {
  const stopping = stopRequest && stopRequest.matchId === live.manifest?.matchId;
  return !menuVisible && !replay && !live.done && !stopping ? live.manifest?.mode : null;
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
  if (event.repeat || heldKeys.has(event.code)) return;
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
