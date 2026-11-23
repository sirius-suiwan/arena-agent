import { renderers } from './renderers.js';
import { emptyKillTotals, countKills } from './score-data.js';
import { indexLethalProjectiles, lethalProjectileRings } from './replay-highlight.js';
import { matchMode, keyboardAction, keySeat, pointerAction, humanControls, humanHelp, pointerSeat, controlLabels } from './input.js';

const byId = (id) => document.getElementById(id);
const el = Object.fromEntries([
  'battle', 'mode-label', 'match-form', 'seed', 'simulation-rate', 'shrink-after', 'shrink-duration', 'round-limit', 'maze-cols', 'maze-rows', 'maze-complexity', 'friendly-fire', 'team-mode', 'team-scoreboard', 'arena-zone', 'back-live', 'replay-file',
  'status', 'error', 'frame-label', 'time-label', 'human-help', 'timeline-panel',
  'match-id', 'match-id-value', 'match-id-copy',
  'match-controls', 'stop-match', 'play-replay', 'stop-replay', 'details', 'menu', 'stage', 'return-menu', 'continue-match',
  'scoreboard', 'kill-board', 'arena-round-mode', 'arena-round', 'arena-round-target', 'round-label', 'round-notice', 'canvas-wrap',
  'kill-panel', 'kill-markers', 'kill-status',
  'custom-seat-list', 'custom-seat-status', 'custom-start',
  'seat-name-A', 'seat-name-B', 'seat-name-C', 'seat-name-D', 'seat-name-E', 'seat-name-F', 'seat-name-G', 'seat-name-H', 'seat-bot-A', 'seat-bot-B', 'seat-bot-C', 'bot-catalog-status',
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
let starting = false;
const teamIds = ['1', '2', '3', '4'];
const teamLetter = (id) => 'ABCD'[teamIds.indexOf(id)] ?? id;
const matchOptions = [
  { id: 'simulation-rate', key: 'simulationRate', values: [25, 30, 60], initial: 25, label: '模拟频率' },
  { id: 'round-limit', key: 'roundLimit', min: 0, max: 20, initial: 0, label: '总局数' },
  { id: 'maze-cols', key: 'cols', min: 4, max: 16, initial: 12, label: '地图列数' },
  { id: 'maze-rows', key: 'rows', min: 4, max: 12, initial: 9, label: '地图行数' },
  { id: 'maze-complexity', key: 'mazeComplexity', values: ['open', 'classic', 'dense'], initial: 'classic', label: '迷宫复杂度' },
  { id: 'friendly-fire', key: 'friendlyFire', initial: false },
  { id: 'shrink-after', key: 'shrinkAfterSeconds', min: 0, max: 120, initial: 40, label: '缩圈开始时间' },
  { id: 'shrink-duration', key: 'shrinkDurationSeconds', min: 1, max: 120, initial: 15, label: '缩圈持续时间' },
];
let botCatalog = new Map();
const seatIds = [...'ABCDEFGH'];
const customSeats = new Map();
let customError = '';
let stopRequest = null;
let menuVisible = true;
let streamOpen = false;
let drawPending = false;
let eventRowsDirty = true;
let importSequence = 0;
let inputEpoch = 0;
let scoreKey = '';
let hudRows = [];
let fieldRatio = '';
const EFFECT_BASE_TICK_RATE = 60;
const EFFECT_MAX_AGE_SECONDS = 1;

function recordedTickRate(value) {
  return Number.isFinite(value) && value > 0 ? value : EFFECT_BASE_TICK_RATE;
}
const MAX_SEAT_NAME_LENGTH = 24;
const heldKeys = new Set();
const inputChains = new Map();
const lastInput = new Map();
let pointerTarget = null;
let pointerPressed = false;
const neutral = { throttle: 0, turn: 0, fire: false };
function tickOf(record) {
  return record?.state?.tick ?? 0;
}

function appendTick(match, record) {
  const index = match.frames.length;
  const actions = record.input && Object.fromEntries(Object.entries(record.input).map(([id, entry]) => [
    id, entry?.fallback == null ? entry?.accepted : { action: entry.accepted, fallback: entry.fallback },
  ]));
  const frameEvents = Array.isArray(record.events) ? record.events.filter((e) => e && typeof e === 'object') : [];
  const previousKills = match.frames.at(-1)?.kills
    ?? emptyKillTotals(match.manifest?.players ?? record.state?.tanks?.map(({ id }) => id) ?? []);
  const kills = match === live && record.stats?.kills && typeof record.stats.kills === 'object'
    ? { ...record.stats.kills } : countKills(previousKills, frameEvents, teamsFor(match.manifest, record.state));
  match.frames.push({ tick: tickOf(record), state: record.state, actions, events: frameEvents, kills });
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
  const reasonText = ({ 'last-tank': '场上最后一辆坦克', 'last-team': '场上最后一支队伍', timeout: '达到时间上限', tick_limit: '达到时间上限', 'double-knockout': '同时被击毁', 'score-target': '达到目标分数', 'score-limit': '达到目标分数', 'round-limit': '达到局数上限' })[reason] ?? reason;
  const winner = teamIds.includes(result.winnerTeam) ? `队伍 ${teamLetter(result.winnerTeam)} 获胜`
    : result.winner == null ? '平局' : `选手 ${playerLabel(manifest, result.winner)} 获胜`;
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
      const ownerId = event.ownerId;
      const victim = playerLabel(replay.manifest, event.tankId ?? '？');
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

function effectsAt(frames, index, manifestRate) {
  const effects = [];
  const now = tickOf(frames[index]);
  const round = frames[index].state?.round;
  const rate = recordedTickRate(manifestRate);
  for (let i = index; i >= 0 && now - tickOf(frames[i]) < EFFECT_MAX_AGE_SECONDS * rate; i--) {
    if (frames[i].state?.round !== round) break;
    // Visual effects use 1/60-second units, independently of simulation rate.
    const age = (now - tickOf(frames[i])) * EFFECT_BASE_TICK_RATE / rate;
    for (const event of frames[i].events) {
      if (age < 10 || event.type === 'pickup' || event.type === 'pickup-blocked') effects.push({ event, age });
    }
  }
  return effects;
}

function makeNode(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = value;
  return node;
}

function setText(node, text) {
  if (node.textContent !== String(text)) node.textContent = String(text);
}

function teamsFor(manifest, state) {
  return state?.teams ?? manifest?.config?.teams ?? {};
}

function renderScoreboard(match, state, renderer, kills = {}) {
  const teams = teamsFor(match.manifest, state);
  const ids = [...(state?.tanks?.map((tank) => tank.id) ?? match.manifest?.players ?? [])];
  ids.sort((a, b) => String(teams[a] ?? '').localeCompare(String(teams[b] ?? '')));
  const activeTeams = teamIds.filter((team) => ids.some((id) => teams[id] === team));
  const teamScore = el['team-scoreboard'];
  teamScore.hidden = activeTeams.length === 0;
  setText(teamScore, activeTeams.map((team) => `队伍 ${teamLetter(team)}：${state?.teamScores?.[team] ?? 0} 分`).join('　·　'));
  const names = ids.map((id) => playerName(match.manifest, id));
  const key = JSON.stringify([match.manifest?.mode, ids, names, ids.map((id) => teams[id]), renderer?.title]);
  if (scoreKey !== key) {
    scoreKey = key;
    const items = document.createDocumentFragment();
    const railItems = document.createDocumentFragment();
    hudRows = ids.map((id, index) => {
      const card = makeNode('div', 'score player-result');
      const player = playerLabel(match.manifest, id);
      const color = renderer?.seatColor?.(index, match.manifest?.mode, id);
      const identity = makeNode('div', 'score-identity');
      const name = makeNode('strong', 'score-name', names[index]);
      name.dir = 'auto';
      identity.append(name);
      const team = teams[id];
      if (teamIds.includes(team)) {
        const tag = makeNode('span', 'team-badge', `队 ${teamLetter(team)}`);
        tag.setAttribute('data-team', team);
        identity.append(tag);
      }
      const face = makeNode('div', 'score-face');
      const icon = makeNode('canvas', 'score-icon');
      const number = makeNode('span', 'score-number', '0');
      const ammo = makeNode('div', 'score-ammo');
      const slots = makeNode('span', 'ammo-bars');
      slots.setAttribute('aria-hidden', 'true');
      const available = makeNode('span', 'ammo-quantity');
      ammo.append(slots, available);
      face.append(icon, number, ammo);
      const equip = makeNode('div', 'score-equipment');
      const weaponIcon = makeNode('canvas', 'weapon-badge');
      const weaponText = makeNode('span', 'weapon-text');
      equip.append(weaponIcon, weaponText);
      card.append(face, identity, equip);
      card.title = player;
      icon.setAttribute('aria-hidden', 'true');
      weaponIcon.setAttribute('aria-hidden', 'true');
      if (color) card.style.setProperty('--seat-tint', color);

      const rail = makeNode('li', 'kill-seat');
      const railIcon = makeNode('canvas', 'kill-icon');
      railIcon.setAttribute('aria-hidden', 'true');
      const railName = makeNode('span', 'kill-name', names[index]);
      railName.dir = 'auto';
      const count = makeNode('strong', 'kill-number', '0');
      rail.append(railIcon, count, railName);
      rail.title = player;
      items.append(card);
      railItems.append(rail);
      return { id, player, card, icon, number, ammo, slots, available, equip, weaponIcon,
        weaponText, rail, railIcon, count, maxAmmo: 0, bars: [], equipment: undefined };
    });
    el.scoreboard.replaceChildren(items);
    el['kill-board'].replaceChildren(railItems);
    el.scoreboard.style.setProperty('--score-columns', Math.min(4, ids.length || 2));
    el.stage.classList.toggle('many-seats', ids.length > 4);
    hudRows.forEach(({ id, icon, railIcon }, index) => {
      renderer?.scoreIcon?.(icon, index, match.manifest?.mode, id);
      renderer?.scoreIcon?.(railIcon, index, match.manifest?.mode, id);
    });
  }
  for (const row of hudRows) {
    const tank = state?.tanks?.find(({ id }) => id === row.id);
    const dead = tank?.alive === false;
    const score = state?.scores?.[row.id] ?? (state?.result?.winner === row.id ? 1 : 0);
    const ammo = tank ? renderer?.ammo?.(state, row.id) : null;
    const equipped = renderer?.equippedWeapon?.(tank, state) ?? null;
    const weapon = equipped && renderer?.weaponLabel?.(equipped);
    const killCount = Number.isSafeInteger(kills[row.id]) ? Math.max(0, kills[row.id]) : 0;
    row.card.classList.toggle('is-destroyed', dead);
    row.rail.classList.toggle('is-destroyed', dead);
    row.number.hidden = teamIds.includes(teams[row.id]);
    setText(row.number, score);
    setText(row.count, killCount);
    row.rail.setAttribute('aria-label', `${row.player}：${killCount} 次击杀`);
    row.ammo.hidden = !ammo;
    if (ammo) {
      setText(row.available, `${ammo.available}/${ammo.limit}`);
      row.ammo.title = '空闲普通弹槽，开火仍受冷却和特殊武器状态限制';
      if (row.maxAmmo !== ammo.limit) {
        row.maxAmmo = ammo.limit;
        row.bars = Array.from({ length: ammo.limit }, () => makeNode('span', 'ammo-slot'));
        row.slots.replaceChildren(...row.bars);
      }
      row.bars.forEach((bar, index) => bar.classList.toggle('is-free', index < ammo.available));
    }
    row.equip.hidden = !weapon;
    if (weapon) {
      const quantity = Number.isSafeInteger(tank?.weaponAmmo) && tank.weaponAmmo > 0 ? ` ×${tank.weaponAmmo}`
        : equipped === 'frag' && tank?.fragId ? ' · 可引爆'
        : equipped === 'remote' && tank?.fragId ? ' · 转向操控' : '';
      setText(row.weaponText, `${weapon}${quantity}`);
      row.equip.title = `已装备${weapon}`;
      if (row.equipment !== equipped) renderer?.weaponIcon?.(row.weaponIcon, equipped);
      row.equipment = equipped;
    } else if (!weapon) row.equipment = undefined;
    row.card.setAttribute('aria-label', `选手 ${row.player}：${teamIds.includes(teams[row.id]) ? '队伍 ' + teamLetter(teams[row.id]) : score + ' 分'}${dead ? '，本局已击毁' : ''}${ammo ? `，空闲普通弹槽 ${ammo.available}/${ammo.limit}` : ''}${weapon ? `，已装备${weapon}` : ''}`);
  }
  const round = state?.round ?? 1;
  const fixed = state?.roundLimit ?? match.manifest?.config?.roundLimit;
  const target = Number.isSafeInteger(fixed) && fixed > 0 ? `共 ${fixed} 局`
    : Number.isSafeInteger(state?.targetScore) ? `先到 ${state.targetScore} 分` : '单局对战';
  setText(el['arena-round-mode'], matchMode(match.manifest?.mode)?.label ?? '坦克对战');
  setText(el['arena-round'], `第 ${round} 局`);
  setText(el['arena-round-target'], target);
  el['round-label'].textContent = `第 ${round} 局 · ${target}`;
  const notice = el['round-notice'];
  if (match.done && match.result?.reason === 'stopped' && (!replay || frameIndex === match.frames.length - 1)) {
    notice.hidden = false;
    notice.textContent = '已停止';
  } else if (state?.phase === 'intermission') {
    notice.hidden = false;
    notice.textContent = teamIds.includes(state.roundWinnerTeam) ? `队伍 ${teamLetter(state.roundWinnerTeam)} 拿下本局`
      : state.roundWinner == null ? '本局平局' : `选手 ${playerLabel(match.manifest, state.roundWinner)} 拿下本局`;
  } else if (state?.phase === 'finished' && state.result) {
    notice.hidden = false;
    notice.textContent = outcome(state.result, match.manifest);
  } else if (match.done && match.result && (!replay || frameIndex === match.frames.length - 1)) {
    notice.hidden = false;
    notice.textContent = outcome(match.result, match.manifest);
  } else notice.hidden = true;
}

function elapsedLabel(tick, nominalRate) {
  const rate = recordedTickRate(nominalRate);
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

function zoneLabel(state, tickRate) {
  const zone = state?.zone;
  const tick = state?.roundTick;
  if (!zone || ![tick, zone.startTick, zone.endTick].every(Number.isFinite)) return '';
  const rate = recordedTickRate(tickRate);
  const seconds = (ticks) => Math.ceil(ticks / rate);
  if (tick < zone.startTick) return `缩圈倒计时 ${seconds(zone.startTick - tick)} 秒`;
  if (tick < zone.endTick) return `正在缩圈 · ${seconds(zone.endTick - tick)} 秒`;
  return '缩圈完成';
}

function render() {
  drawPending = false;
  const match = replay ?? live;
  const current = replay ? frameIndex : match.frames.length - 1;
  const record = match.frames[current];
  const hasFrames = Boolean(record?.state);
  const matchActive = Boolean(live.manifest) && !live.done;
  const mode = matchMode(live.manifest?.mode);
  const help = !replay && matchActive && humanHelp(live.manifest);
  el['mode-label'].textContent = replay ? '离线回放' : mode?.label ?? '实时观战';
  const frame = hasFrames ? tickOf(record) : 0;
  el['frame-label'].textContent = `TICK ${frame}${match.manifest?.tickRate ? ` · ${match.manifest.tickRate} tick/s` : ''}`;
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
  el.battle.classList.toggle('pointer-control', Boolean(pointerSeat(activeManifest())));
  el['back-live'].hidden = !replay;
  el['timeline-panel'].hidden = !replay;
  for (const button of el['match-form'].querySelectorAll('button')) {
    button.disabled = starting || matchActive || (!botCatalog.size && ['bots', 'human'].includes(button.value));
  }
  el['custom-start'].disabled = starting || matchActive || Boolean(customError);
  el.seed.disabled = starting || matchActive;
  for (const option of matchOptions) el[option.id].disabled = starting || matchActive;
  const zoneText = zoneLabel(record?.state, match.manifest?.tickRate);
  el['arena-zone'].hidden = !zoneText;
  el['arena-zone'].textContent = zoneText;
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
      el.stage.style.setProperty('--field-ratio', ratio);
    }
    el.battle.setAttribute('aria-label', renderer.title);
    renderer.draw(el.battle, record.state, {
      mode: match.manifest?.mode,
      teams: teamsFor(match.manifest, record.state),
      effects: effectsAt(match.frames, current, match.manifest?.tickRate),
      lethalRings: replay ? lethalProjectileRings(replay.lethalIndex, record, current) : [],
    });
  } else if (!menuVisible) {
    el.battle.getContext('2d')?.clearRect(0, 0, el.battle.width, el.battle.height);
  }
  if (!menuVisible) renderScoreboard(match, record?.state, renderer, record?.kills);
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
  const tickRate = recordedTickRate(replay.manifest.tickRate);
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
    live.manifest = record.manifest;
    appendTick(live, record);
    if (!replay) setError('');
  } else if (record.type === 'tick' && record.state && live.manifest && (!live.done || live.result?.reason === 'stopped')) {
    if (tickOf(record) <= tickOf(live.frames.at(-1))) return;
    // Keep a small recent history so transient effects render the same way as replay.
    appendTick(live, record);
    const keep = Math.ceil(EFFECT_MAX_AGE_SECONDS * recordedTickRate(live.manifest.tickRate));
    if (live.frames.length > keep) live.frames.shift();
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
      for (const id of Object.keys(humanControls(live.manifest))) sendInput(id, neutral);
      setError(`无法停止对局：${error.message}`);
    }
  } finally {
    if (stopRequest === request) stopRequest = null;
    liveStatus();
    queueDraw();
  }
});

function readCustomSeats() {
  const seats = {};
  const controls = new Set();
  for (const [id, { select }] of customSeats) {
    const value = select.value;
    if (!value) continue;
    const [kind, choice] = value.split(':');
    if (kind === 'bot' && botCatalog.has(choice)) seats[id] = { bot: choice };
    else if (kind === 'control' && Object.hasOwn(controlLabels, choice) && !controls.has(choice)) {
      controls.add(choice);
      seats[id] = { control: choice };
    } else return { seats, error: '每套本地控制只能使用一次，请检查席位配置。' };
  }
  const teams = el['team-mode'].checked
    ? Object.fromEntries(Object.keys(seats).map((id) => [id, customSeats.get(id).team.value]))
    : null;
  if (teams && (!Object.values(teams).every((team) => teamIds.includes(team))
      || new Set(Object.values(teams)).size < 2)) {
    return { seats, error: '队伍对战需要为每个启用的席位分队，且至少有两支队伍。' };
  }
  return { seats, teams, error: Object.keys(seats).length < 2 ? '至少启用两席。' : '' };
}

function updateCustomSeatOptions() {
  const selected = new Map([...customSeats].map(([id, { select }]) => [id, select.value]));
  for (const [id, { options, team }] of customSeats) {
    team.hidden = !el['team-mode'].checked || !selected.get(id);
    team.disabled = team.hidden;
    for (const option of options) {
      option.disabled = option.value.startsWith('control:') &&
        [...selected].some(([other, value]) => other !== id && value === option.value);
    }
  }
  const { seats, error } = readCustomSeats();
  customError = error;
  el['custom-seat-status'].textContent = error || `已启用 ${Object.keys(seats).length}/8 席。`;
  queueDraw();
}

function rebuildCustomSeats() {
  const values = Object.fromEntries([...customSeats].map(([id, { select }]) => [id, select.value]));
  const assignments = Object.fromEntries([...customSeats].map(([id, { team }]) => [id, team.value]));
  const items = document.createDocumentFragment();
  customSeats.clear();
  for (const id of seatIds) {
    const label = makeNode('label', '', id);
    const select = makeNode('select');
    select.id = `custom-seat-${id}`;
    select.setAttribute('aria-label', `座位 ${id}`);
    const choices = [['', '关闭'], ...Object.entries(controlLabels).map(([control, name]) =>
      [`control:${control}`, `本地玩家 · ${name}`]),
    ...Array.from(botCatalog, ([key, name]) => [`bot:${key}`, `Bot · ${name}`])];
    const options = choices.map(([key, name]) => {
      const option = makeNode('option', '', name);
      option.value = key;
      return option;
    });
    select.append(...options);
    const previous = values[id] ?? (id === 'A' ? 'control:arrows' : id === 'B' ? 'control:esdf' : '');
    select.value = choices.some(([value]) => value === previous) ? previous : '';
    select.addEventListener('change', updateCustomSeatOptions);
    const team = makeNode('select', 'seat-team');
    team.id = `custom-team-${id}`;
    team.setAttribute('aria-label', `座位 ${id} 的队伍`);
    team.append(...teamIds.map((number) => {
      const option = makeNode('option', '', `队 ${teamLetter(number)}`);
      option.value = number;
      return option;
    }));
    team.value = assignments[id] ?? (seatIds.indexOf(id) % 2 ? '2' : '1');
    team.addEventListener('change', updateCustomSeatOptions);
    customSeats.set(id, { select, options, team });
    const row = makeNode('div', 'custom-seat-row');
    label.append(select);
    row.append(label, team);
    items.append(row);
  }
  el['custom-seat-list'].replaceChildren(items);
  updateCustomSeatOptions();
}

el['team-mode'].addEventListener('change', updateCustomSeatOptions);

async function loadBotCatalog() {
  const status = el['bot-catalog-status'];
  try {
    const response = await fetch('/api/bots', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new Error(typeof problem.error === 'string' ? problem.error : `HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!Array.isArray(data?.bots)) throw new Error('机器人目录格式不正确。');
    const entries = data.bots.filter(bot => typeof bot?.id === 'string' && bot.id && typeof bot.name === 'string' && bot.name);
    entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    botCatalog = new Map(entries.map(({ id, name }) => [id, name]));
    if (!botCatalog.size) {
      status.textContent = '没有已注册的机器人，本地多人仍可开局。';
      return;
    }
    const firstBot = botCatalog.keys().next().value;
    for (const seat of ['A', 'B', 'C']) {
      const select = el[`seat-bot-${seat}`];
      const options = document.createDocumentFragment();
      if (seat === 'C') {
        const off = document.createElement('option');
        off.value = '';
        off.textContent = '不参赛';
        options.append(off);
      }
      for (const [id, name] of botCatalog) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        options.append(option);
      }
      select.replaceChildren(options);
      const preferred = seat === 'B' ? 'laika' : 'gpt-dots';
      select.value = seat === 'C' ? '' : botCatalog.has(preferred) ? preferred : firstBot;
      select.disabled = false;
    }
    status.hidden = true;
  } catch (error) {
    status.textContent = `无法读取机器人目录（${error.message}）。修正后可刷新重试，本地多人仍可开局。`;
  } finally {
    rebuildCustomSeats();
  }
}

for (const option of matchOptions) {
  el[option.id].addEventListener('input', () => { option.edited = true; });
}

function validOption(value, option) {
  if (option.values) return option.values.includes(value);
  if (typeof option.initial === 'boolean') return typeof value === 'boolean';
  return Number.isInteger(value) && value >= option.min && value <= option.max;
}

async function loadMatchOptions() {
  try {
    const response = await fetch('/api/options', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const defaults = await response.json();
    for (const option of matchOptions) {
      const value = defaults?.[option.key];
      if (!validOption(value, option)) continue;
      option.serverDefault = value;
      if (option.edited) continue;
      if (typeof value === 'boolean') el[option.id].checked = value;
      else el[option.id].value = String(value);
    }
  } catch {
    // Keep usable settings while the local server is temporarily unreachable.
  }
}
void loadMatchOptions();

el['match-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  if (starting || (live.manifest && !live.done)) return;
  if (!streamOpen) return setError('尚未连到裁判，请稍后重试。');
  const requested = event.submitter?.value;
  const mode = matchMode(requested) ? requested : 'human';
  const seed = Number(el.seed.value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return setError('种子必须是有效的非负整数。');
  const overrides = {};
  for (const option of matchOptions) {
    const element = el[option.id];
    const value = typeof option.initial === 'boolean' ? Boolean(element.checked)
      : typeof option.initial === 'number' ? (element.value ? Number(element.value) : NaN) : element.value;
    if (!validOption(value, option)) {
      return setError(option.values ? `请选择有效的${option.label}。`
        : `${option.label}必须是 ${option.min}–${option.max} 的整数。`);
    }
    if (value !== (option.serverDefault ?? option.initial) || (option.edited && option.serverDefault === undefined)) {
      overrides[option.key] = value;
    }
  }
  const custom = mode === 'custom' ? readCustomSeats() : null;
  if (custom?.error) return setError(custom.error);
  const thirdBot = mode === 'bots' && Boolean(el['seat-bot-C'].value);
  const botSeats = mode === 'bots' ? (thirdBot ? ['A', 'B', 'C'] : ['A', 'B']) : mode === 'human' ? ['B'] : [];
  const bots = Object.fromEntries(botSeats.map(id => [id, el[`seat-bot-${id}`].value]));
  if (botSeats.some(id => !botCatalog.has(bots[id]))) return setError('请先选择有效的已注册机器人。');
  const seats = custom ? Object.keys(custom.seats) : mode === 'local3' || thirdBot ? ['A', 'B', 'C'] : ['A', 'B'];
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
  setError('');
  setStatus('正在启动对局…');
  queueDraw(true);
  try {
    await post('/api/match', {
      mode, seed,
      ...overrides,
      ...(botSeats.length ? { bots } : {}),
      ...(custom ? { seats: custom.seats } : {}),
      ...(custom?.teams ? { teams: custom.teams } : {}),
      ...(Object.keys(playerNames).length ? { playerNames } : {}),
    });
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
  const game = manifest?.game;
  return Object.hasOwn(renderers, game) ? renderers[game] : null;
}

async function readReplay(file, stillCurrent) {
  if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持 gzip 回放，请使用新版浏览器。');
  const [{ createReplayReconstructor, parseReplayLine, MAX_REPLAY_LINE }, { gameForRate }] = await Promise.all([
    import('/replay/reconstruct.js'),
    import('/games/tank-trouble/adapter/index.js'),
  ]);
  if (!stillCurrent()) return null;
  const reconstruct = createReplayReconstructor((manifest) => {
    if (manifest?.game !== 'tank-trouble') return null;
    return gameForRate(manifest.tickRate);
  }, { mode: 'playback' });
  const candidate = blank();
  const reader = file.stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream('utf-8', { fatal: true })).getReader();
  let pending = '';
  let number = 0;
  const parseLine = (line) => {
    number++;
    if (line.length > MAX_REPLAY_LINE) throw new Error(`第 ${number} 行过长。`);
    if (!line.trim()) return;
    try {
      const row = parseReplayLine(line);
      const view = reconstruct.push(row);
      if (row.type === 'start') candidate.manifest = row.manifest;
      if (row.type === 'start' || row.type === 'tick') appendTick(candidate, view);
    } catch (error) {
      throw new Error(`第 ${number} 行：${error.message}`);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (!stillCurrent()) return null;
      if (done) break;
      const lines = (pending + value).split('\n');
      pending = lines.pop();
      if (pending.length > MAX_REPLAY_LINE) throw new Error(`第 ${number + 1} 行过长。`);
      for (const line of lines) {
        parseLine(line);
        if (number % 200 === 0) {
          // Keep navigation and a replacement import responsive while reconstructing long matches.
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (!stillCurrent()) return null;
        }
      }
    }
    if (pending) parseLine(pending);
    candidate.result = reconstruct.finish().result;
    candidate.done = true;
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
    setStatus(`回放：${outcome(candidate.result, candidate.manifest)}。`);
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

function activeManifest() {
  const stopping = stopRequest && stopRequest.matchId === live.manifest?.matchId;
  return !menuVisible && !replay && !live.done && !stopping ? live.manifest : null;
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
    const matchId = live.manifest?.matchId;
    await post('/api/input', { playerId, ...(matchId ? { matchId } : {}), ...action }, 1000);
  }).catch(() => {
    if (lastInput.get(playerId) === action) lastInput.delete(playerId);
    if (activeManifest()) setError('输入未送达裁判。');
  });
  inputChains.set(playerId, pending);
}

function updatePointer() {
  const seat = pointerSeat(activeManifest());
  if (!seat || (!pointerTarget && !pointerPressed && !lastInput.has(seat))) return;
  const state = live.frames.at(-1)?.state;
  const tank = state?.tanks?.find(({ id }) => id === seat);
  sendInput(seat, pointerAction(tank, pointerTarget, pointerPressed));
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
  if (!pointerSeat(activeManifest())) return;
  setPointerTarget(event);
  updatePointer();
});
el.battle.addEventListener('pointerdown', (event) => {
  if (!pointerSeat(activeManifest()) || event.button !== 0) return;
  event.preventDefault();
  el.battle.setPointerCapture?.(event.pointerId);
  setPointerTarget(event);
  pointerPressed = true;
  updatePointer();
});
el.battle.addEventListener('pointerup', (event) => {
  if (!pointerSeat(activeManifest()) || event.button !== 0) return;
  pointerPressed = false;
  updatePointer();
});
for (const name of ['pointerleave', 'pointercancel']) {
  el.battle.addEventListener(name, () => {
    if (!pointerSeat(activeManifest())) return;
    pointerTarget = null;
    pointerPressed = false;
    updatePointer();
  });
}
addEventListener('keydown', (event) => {
  const mode = activeManifest();
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
  const mode = activeManifest();
  const seat = keySeat(mode, event.code);
  if (seat) sendInput(seat, keyboardAction(mode, seat, heldKeys));
});
addEventListener('blur', releaseInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseInput(); });
new ResizeObserver(() => queueDraw()).observe(el.battle);
rebuildCustomSeats();
void loadBotCatalog();
queueDraw();
