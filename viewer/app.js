import { matchOptionDefinitions, validOption, tidyName, readSetup, saveSetup, clearSetup, sanitizeSetup } from './settings-store.js';
import { renderers } from './renderers.js';
import { emptyKillTotals, countKills } from './score-data.js';
import { indexLethalProjectiles, lethalProjectileRings } from './replay-highlight.js';
import { matchMode, keyboardAction, keySeat, pointerAction, humanControls, humanHelp, pointerSeat, controlLabels } from './input.js';

const byId = (id) => document.getElementById(id);
const el = Object.fromEntries([
  'battle', 'mode-label', 'match-form', 'seed', 'match-seed', 'match-insight', 'simulation-rate', 'map-size-mode', 'map-size-preview', 'reset-setup', 'shrink-center', 'shrink-after', 'shrink-duration', 'round-limit', 'maze-cols', 'maze-rows', 'maze-complexity', 'friendly-fire', 'team-mode', 'team-scoreboard', 'arena-zone', 'back-live', 'replay-file',
  'status', 'error', 'frame-label', 'time-label', 'human-help', 'timeline-panel',
  'match-id', 'match-id-value', 'match-id-copy',
  'match-controls', 'stop-match', 'play-replay', 'stop-replay', 'details', 'menu', 'stage', 'return-menu', 'continue-match',
  'scoreboard', 'kill-board', 'arena-round-mode', 'arena-round', 'arena-round-target', 'round-label', 'round-notice', 'canvas-wrap',
  'kill-panel', 'kill-markers', 'kill-status', 'readiness-warning',
  'live-clock','arena-alive','live-summary','menu-hero','setup-view','menu-start','open-setup','close-setup','setup-inspection','menu-replay','hero-tank-a','hero-tank-b',
  'startup-panel','startup-title','startup-count','startup-progress','startup-seats','startup-seconds','startup-cancel',
  'custom-seat-list', 'custom-seat-status', 'custom-start',
  'seat-name-A', 'seat-name-B', 'seat-name-C', 'seat-name-D', 'seat-name-E', 'seat-name-F', 'seat-name-G', 'seat-name-H', 'seat-bot-A', 'seat-bot-B', 'seat-bot-C', 'bot-catalog-status',
  'timeline', 'prev', 'next', 'event-count', 'event-hint', 'event-list', 'frame-actions',
].map((id) => [id, byId(id)]));

const blank = () => ({ manifest: null, readiness: null, frames: [], events: [], totalEvents: 0, result: null, done: false });
let live = blank();
let replay = null;
let selectedKill = null;
let markerSource = null;
let markerButtons = new Map();
let frameIndex = 0;
let playback = null;
let starting = false;
let startAttempt = null;
let startupSnapshot = null;
let startupTimer = null;
let startupRendered = null;
let setupVisible = false;
let menuArtDrawn = false;
let compactSummary = null;
let dismissedStartupId = null;
const loadingMatch = blank();
const startupDismissed = () => startupSnapshot?.phase === 'failed';

function clearStartAttempt() {
  if (startAttempt) clearTimeout(startAttempt.timer);
  startAttempt = null;
  startupSnapshot = null;
  clearTimeout(startupTimer);
  startupTimer = null;
  starting = false;
}

function failStartAttempt(attempt, message) {
  if (startAttempt !== attempt) return;
  clearStartAttempt();
  if (!replay) {
    menuVisible = true;
    setError(message);
  }
  liveStatus();
  queueDraw(true);
}
const teamIds = ['1', '2', '3', '4'];
const teamLetter = (id) => 'ABCD'[teamIds.indexOf(id)] ?? id;
const matchOptions = matchOptionDefinitions.map(option => ({ ...option }));
let setup = readSetup();
let autoMapSizes = {};
let autoMazeDensities = {};
let autoPickupProfiles = {};
const densityLabel = Object.freeze({ open: '开阔', classic: '经典', dense: '密集' });
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
let paintedRecord = null;
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
  if (record.type === 'start') match.readiness = record.readiness ?? null;
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
      if (age < 10 || event.type === 'pickup' || event.type === 'pickup-blocked' ||
          event.type === 'laser-path' && age < event.fadeTicks * EFFECT_BASE_TICK_RATE / rate ||
          event.type === 'shell-expired' && event.kind === 'shrapnel' && event.reason === 'wall') effects.push({ event, age });
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
      const life = makeNode('span', 'score-life');
      identity.append(life);
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
      const shieldBadge = makeNode('canvas', 'weapon-badge shield-badge');
      shieldBadge.setAttribute('aria-hidden', 'true');
      const shieldText = makeNode('span', 'shield-text', '护盾');
      equip.append(weaponIcon, weaponText, shieldBadge, shieldText);
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
      const railScore = makeNode('strong', 'kill-score');
      rail.append(railIcon, railName, railScore, count);
      rail.title = player;
      items.append(card);
      railItems.append(rail);
      return { id, player, card, icon, number, ammo, slots, available, equip, weaponIcon, life, shieldBadge, shieldText, railScore,
        weaponText, rail, railIcon, count, maxAmmo: 0, bars: [], equipment: undefined, hadShield: false };
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
    const shield = tank?.shield === true && !dead;
    const killCount = Number.isSafeInteger(kills[row.id]) ? Math.max(0, kills[row.id]) : 0;
    row.card.classList.toggle('is-destroyed', dead);
    row.rail.classList.toggle('is-destroyed', dead);
    row.number.hidden = teamIds.includes(teams[row.id]);
    setText(row.number, score);
    setText(row.life, dead ? '已击毁' : '存活');
    setText(row.railScore, teamIds.includes(teams[row.id]) ? (state?.teamScores?.[teams[row.id]] ?? 0) : score);
    row.railScore.title = '比分';
    row.count.title = '击杀';
    row.ammo.hidden = !ammo || dead;
    setText(row.count, killCount);
    row.rail.setAttribute('aria-label', `${row.player}：${killCount} 次击杀`);

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
    row.equip.hidden = !weapon && !shield;
    if (weapon || shield) {
      const quantity = Number.isSafeInteger(tank?.weaponAmmo) && tank.weaponAmmo > 0 ? ` ×${tank.weaponAmmo}`
        : equipped === 'frag' && tank?.fragId ? ' · 可引爆'
        : equipped === 'remote' && tank?.fragId ? ' · 转向操控'
        : equipped === 'missile' && tank?.fragId ? ' · 导弹飞行中' : '';
      setText(row.weaponText, weapon ? `${weapon}${quantity}` : '');
      row.equip.title = [weapon ? `已装备${weapon}` : '', shield ? '护盾可抵消一次伤害' : ''].filter(Boolean).join('，');
      if (weapon && row.equipment !== equipped) renderer?.weaponIcon?.(row.weaponIcon, equipped);
      row.equipment = equipped;
    } else row.equipment = undefined;
    row.weaponIcon.hidden = row.weaponText.hidden = !weapon;
    row.shieldBadge.hidden = row.shieldText.hidden = !shield;
    if (shield && !row.hadShield) renderer?.weaponIcon?.(row.shieldBadge, 'shield');
    row.hadShield = shield;
    row.card.setAttribute('aria-label', `选手 ${row.player}：${teamIds.includes(teams[row.id]) ? '队伍 ' + teamLetter(teams[row.id]) : score + ' 分'}${dead ? '，本局已击毁' : ''}${ammo ? `，空闲普通弹槽 ${ammo.available}/${ammo.limit}` : ''}${weapon ? `，已装备${weapon}` : ''}${shield ? '，护盾剩余一次' : ''}`);
  }
  const alive = state?.tanks?.filter(tank => tank.alive !== false).length ?? 0;
  setText(el['arena-alive'], state?.tanks?.length ? `${alive}/${state.tanks.length} 存活` : '');
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
  const match = replay ?? (starting || startupDismissed() ? loadingMatch : live);
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
  const currentSeed = match.manifest?.seed;
  el['match-seed'].hidden = !Number.isSafeInteger(currentSeed);
  setText(el['match-seed'], Number.isSafeInteger(currentSeed) ? `种子 ${currentSeed}` : '');
  const insight = match.manifest?.inputInsight;
  const insightSeats = insight?.seats;
  const privileged = Array.isArray(insightSeats) ? insightSeats.filter((id) => typeof id === 'string' && /^[A-H]$/.test(id)).slice(0, 8) : [];
  el['match-insight'].hidden = privileged.length === 0;
  const capabilities = Array.isArray(insight?.capabilities) ? insight.capabilities : [];
  const ability = [
    insight?.contract === 'accepted-opponent-actions' && '读指令',
    capabilities.includes('pickup-forecast') && '刷箱预报',
    capabilities.includes('shrink-destination') && '缩圈终点预报',
  ].filter(Boolean).join('／') || '对局情报';
  setText(el['match-insight'], privileged.length ? `${ability}：${privileged.join('、')}` : '');
  el.menu.hidden = !menuVisible;
  el['setup-view'].hidden = !setupVisible;
  el['menu-hero'].hidden = setupVisible;
  if (menuVisible && !setupVisible && !menuArtDrawn) {
    const renderer = renderers['tank-trouble'];
    renderer?.scoreIcon?.(el['hero-tank-a'], 0, 'bots', 'A');
    renderer?.scoreIcon?.(el['hero-tank-b'], 1, 'bots', 'B');
    menuArtDrawn = true;
  }
  const summaryCompact = globalThis.matchMedia?.('(max-width: 720px)').matches ?? false;
  if (compactSummary !== summaryCompact) {
    compactSummary = summaryCompact;
    el['live-summary'].open = !summaryCompact;
  }
  el['live-clock'].hidden = menuVisible || !hasFrames;
  setText(el['live-clock'], elapsedLabel(frame, match.manifest?.tickRate).replace('对局时间 ', ''));
  el.stage.hidden = menuVisible;
  renderMatchId(match.manifest ?? (starting ? { matchId: startAttempt?.matchId } : null));
  el['return-menu'].hidden = menuVisible;
  el['continue-match'].hidden = (!startAttempt?.matchId && !live.manifest) && !replay;
  el['continue-match'].textContent = replay ? '返回回放' : starting ? '查看启动进度' : '返回对局';
  const startupMatchId = startAttempt?.matchId;
  const stoppableMatchId = startupMatchId ?? (matchActive ? live.manifest.matchId : null);
  const canStopLive = !menuVisible && !replay && typeof stoppableMatchId === 'string';
  const canPlayReplay = !menuVisible && replay?.frames.length > 1;
  const canStopReplay = canPlayReplay && (Boolean(playback) || frameIndex > 0);
  const stopping = Boolean(stopRequest && stopRequest.matchId === stoppableMatchId);
  el['match-controls'].hidden = !canStopLive && !canPlayReplay;
  el['stop-match'].hidden = !canStopLive;
  el['stop-match'].disabled = stopping || (!streamOpen && !startupMatchId);
  el['stop-match'].textContent = startupMatchId ? (stopping ? '正在取消…' : '取消启动')
    : stopping ? '停止中…' : '停止对局';
  el['play-replay'].hidden = !canPlayReplay;
  el['play-replay'].disabled = Boolean(playback);
  el['play-replay'].textContent = frameIndex === replay?.frames.length - 1 ? '重播' : '播放回放';
  el['stop-replay'].hidden = !canStopReplay;
  const readiness = match.readiness;
  const unavailable = readiness && match.manifest?.players?.flatMap(id => {
    const reason = readiness[id];
    const label = startupFailureLabel(reason);
    return typeof reason === 'string' && reason !== 'ready'
      ? [`${playerLabel(match.manifest, id)}（${label || '未就绪'}）`] : [];
  });
  el['readiness-warning'].hidden = !unavailable?.length;
  setText(el['readiness-warning'], unavailable?.length ? `机器人启动失败：${unavailable.join('、')}。` : '');
  el['human-help'].hidden = !help;
  el['human-help'].textContent = help || '';
  el.battle.classList.toggle('pointer-control', Boolean(pointerSeat(activeManifest())));
  el['back-live'].hidden = !replay;
  el['timeline-panel'].hidden = !replay;
  el.seed.disabled = starting || matchActive;
  if (menuVisible) {
    // Match setup is hidden during playback. Do not rebuild its preview or
    // rewrite unrelated controls for each incoming simulation tick.
    for (const button of el['match-form'].querySelectorAll('button')) {
      button.disabled = starting || matchActive || (!botCatalog.size && ['bots', 'human'].includes(button.value));
    }
    el['menu-start'].disabled = el['custom-start'].disabled = starting || matchActive || Boolean(customError);
    const autoMap = el['map-size-mode'].value === 'auto';
    for (const option of matchOptions) el[option.id].disabled = starting || matchActive
      || (autoMap && ['cols', 'rows'].includes(option.key));
    el['reset-setup'].disabled = starting || matchActive;
    updateMapPreview();
  }
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
    if (paintedRecord !== record) {
      el.battle.setAttribute('aria-label', renderer.title);
      renderer.draw(el.battle, record.state, {
        mode: match.manifest?.mode,
        teams: teamsFor(match.manifest, record.state),
        effects: effectsAt(match.frames, current, match.manifest?.tickRate),
        lethalRings: replay ? lethalProjectileRings(replay.lethalIndex, record, current) : [],
      });
      paintedRecord = record;
    }
  } else {
    paintedRecord = null;
    if (!menuVisible) el.battle.getContext('2d')?.clearRect(0, 0, el.battle.width, el.battle.height);
  }
  if (!menuVisible) {
    renderScoreboard(match, record?.state, renderer, record?.kills);

  }
  renderStartup();
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
  if (replay || starting) return;
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

const startupFailureLabel = reason => Object.hasOwn(startupFailureLabels, reason) ? startupFailureLabels[reason] : '';
const startupFailureLabels = Object.freeze({
  timeout: '握手超时', startup_timeout: '握手超时', startup_aborted: '启动已取消',
  process_exit: '进程退出', process_unavailable: '进程不可用', line_too_long: '响应超长',
  invalid_json: '响应不是 JSON', protocol_mismatch: '协议不匹配', backpressure: '输入拥堵',
});
const startupStatuses = Object.freeze({ pending: '初始化中', ready: '已就绪', failed: '未就绪' });
function renderStartup() {
  const panel = el['startup-panel'];
  panel.hidden = menuVisible || Boolean(replay) || (!starting && !startupDismissed());
  if (panel.hidden) return;
  const snapshot = startupSnapshot;
  const countdown = snapshot?.phase === 'countdown';
  const failed = snapshot?.phase === 'failed';
  const seats = snapshot?.seats ?? [];
  const ready = seats.filter(seat => seat.status === 'ready').length;
  const stopping = Boolean(stopRequest && stopRequest.matchId === startAttempt?.matchId);
  setText(el['startup-title'], stopping ? '正在取消启动' : countdown ? '战斗即将开始'
    : snapshot?.phase === 'failed' ? '初始化失败' : '正在初始化');
  setText(el['startup-count'], seats.length ? `${ready}/${seats.length} 已就绪` : '等待裁判确认…');
  el['startup-progress'].max = seats.length || 1;
  el['startup-progress'].value = ready;
  el['startup-progress'].hidden = countdown;
  el['startup-seats'].hidden = countdown;
  el['startup-seconds'].hidden = !countdown;
  el['startup-cancel'].disabled = !failed && (el['stop-match'].disabled || el['stop-match'].hidden);
  setText(el['startup-cancel'], failed ? '返回菜单' : stopping ? '正在取消…' : '取消启动');
  if (snapshot !== startupRendered) {
    startupRendered = snapshot;
    const items = document.createDocumentFragment();
    for (const seat of seats) {
      const item = makeNode('li', 'startup-seat');
      const icon = makeNode('canvas', 'startup-icon');
      icon.setAttribute('aria-hidden', 'true');
      const name = makeNode('span', 'startup-name', seat.name);
      const status = makeNode('span', 'startup-badge', seat.status === 'failed' ? (startupFailureLabel(seat.error) || startupStatuses.failed) : startupStatuses[seat.status]);
      status.setAttribute('data-status', seat.status);
      item.append(icon, name, status);
      items.append(item);
      // The score icon uses a CSS-sized canvas; draw after insertion.
      seat.icon = icon;
    }
    el['startup-seats'].replaceChildren(items);
    for (const seat of seats) renderers['tank-trouble']?.scoreIcon?.(seat.icon, 0, snapshot?.mode, seat.id);
  }
  clearTimeout(startupTimer);
  startupTimer = null;
  if (countdown) {
    const remaining = Math.max(0, snapshot.endsAt - performance.now());
    const seconds = Math.ceil(remaining / 1000);
    setText(el['startup-seconds'], seconds || '即将开始');
    if (remaining > 0) startupTimer = setTimeout(queueDraw, remaining - (seconds - 1) * 1000 + 15);
  }
}

function receiveStartup(record) {
  const { matchId, phase } = record;
  if (typeof matchId !== 'string' || !['waiting', 'countdown', 'failed', 'cancelled'].includes(phase)
      || matchId === live.manifest?.matchId || matchId === dismissedStartupId
      || (startAttempt?.matchId && startAttempt.matchId !== matchId)) return;
  if (!startAttempt) {
    startAttempt = { matchId };
    if (!replay) menuVisible = false;
  }
  startAttempt.matchId = matchId;
  starting = true;
  const seats = Object.entries(record.seats ?? {}).filter(([id]) => /^[A-H]$/.test(id)).sort()
    .map(([id, seat]) => ({ id, name: playerName({ playerNames: { [id]: seat?.name } }, id),
      status: Object.hasOwn(startupStatuses, seat?.status) ? seat.status : 'pending', error: seat?.error }));
  const remaining = record.remainingMs ?? record.countdownMs;
  const endsAt = performance.now() + (Number.isFinite(remaining) ? Math.max(0, Math.min(3000, remaining)) : 0);
  startupSnapshot = { phase, seats, endsAt, mode: record.mode };
  if (phase === 'cancelled' || phase === 'failed') {
    dismissedStartupId = matchId;
    const failure = startupSnapshot;
    clearStartAttempt();
    if (phase === 'failed') {
      startupSnapshot = failure;
      if (!replay) setError(record.message || '机器人未能完成初始化。');
    } else if (!replay) menuVisible = true;
  }
  queueDraw(true);
}

function reduceLive(record) {
  if (record.type === 'startup') return receiveStartup(record);
  if (record.matchId && record.matchId === dismissedStartupId) return;
  if (record.type === 'start' && record.state) {
    const id = record.manifest?.matchId;
    if (id && (id === live.manifest?.matchId || id === dismissedStartupId)) return;
    if (startAttempt?.matchId && startAttempt.matchId !== id) return;
    clearStartAttempt();
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
    if (starting) {
      if (record.type === 'error') failStartAttempt(startAttempt, record.message || '裁判报告运行失败。');
      return;
    }
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

el['open-setup'].addEventListener('click', () => { setupVisible = true; queueDraw(); });
el['close-setup'].addEventListener('click', () => { setupVisible = false; queueDraw(); });
el['setup-inspection'].addEventListener('click', () => {
  el.details.open = true;
  el.details.scrollIntoView?.({ block: 'nearest' });
  el.seed.focus?.();
});
el['menu-replay'].addEventListener('click', () => el['replay-file'].click());
el['startup-cancel'].addEventListener('click', () => {
  if (startupDismissed()) {
    startupSnapshot = null;
    menuVisible = true;
    queueDraw(true);
  } else el['stop-match'].click();
});
el['play-replay'].addEventListener('click', play);
el['stop-replay'].addEventListener('click', () => {
  if (!replay) return;
  stopPlayback();
  seek(0);
});

el['stop-match'].addEventListener('click', async () => {
  const attempt = startAttempt;
  const startupMatchId = attempt?.matchId;
  const matchId = startupMatchId ?? live.manifest?.matchId;
  if (replay || menuVisible || typeof matchId !== 'string' || stopRequest?.matchId === matchId
      || (!startupMatchId && (starting || live.done || !streamOpen))) return;
  const request = { matchId };
  stopRequest = request;
  el['stop-match'].disabled = true;
  inputEpoch++;
  resetInput();
  setError('');
  queueDraw();
  try {
    const response = await post('/api/stop', request);
    if (response?.matchId !== request.matchId || !response.result) throw new Error('裁判未确认当前对局状态。');
    if (startupMatchId && startAttempt === attempt && live.manifest?.matchId !== startupMatchId) {
      // Acknowledgement may arrive before the startup's SSE records. Never
      // attach this terminal result to the previous match.
      clearStartAttempt();
      menuVisible = true;
    } else if (!live.done && live.manifest?.matchId === request.matchId) {
      // The terminal SSE can race its HTTP acknowledgment. Accept remaining ticks
      // of this stopped match so the stage still reaches the last saved frame.
      finishLive(response.result);
    }
  } catch (error) {
    if (!replay && startupMatchId && startAttempt === attempt) {
      setError(`无法取消启动：${error.message}`);
    } else if (!replay && !live.done && live.manifest?.matchId === request.matchId) {
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
    const initial = id === 'A' ? 'control:arrows' : id === 'B' ? 'control:esdf' : '';
    const inUse = Object.entries(setup.seats).some(([seat, value]) => seat !== id && value === initial);
    const previous = setup.seats[id] ?? (inUse ? '' : initial);
    select.value = choices.some(([value]) => value === previous) ? previous : '';
    select.addEventListener('change', () => {
      setup.seats[id] = select.value;
      saveSetup(setup);
      updateCustomSeatOptions();
    });
    const team = makeNode('select', 'seat-team');
    team.id = `custom-team-${id}`;
    team.setAttribute('aria-label', `座位 ${id} 的队伍`);
    team.append(...teamIds.map((number) => {
      const option = makeNode('option', '', `队 ${teamLetter(number)}`);
      option.value = number;
      return option;
    }));
    team.value = setup.teams[id] ?? (seatIds.indexOf(id) % 2 ? '2' : '1');
    team.addEventListener('change', () => {
      setup.teams[id] = team.value;
      saveSetup(setup);
      updateCustomSeatOptions();
    });
    customSeats.set(id, { select, options, team });
    const row = makeNode('div', 'custom-seat-row');
    label.append(select);
    row.append(label, team);
    items.append(row);
  }
  el['custom-seat-list'].replaceChildren(items);
  updateCustomSeatOptions();
}

el['team-mode'].addEventListener('change', () => {
  setup.teamMode = el['team-mode'].checked;
  saveSetup(setup);
  updateCustomSeatOptions();
});

function applyBotSelections() {
  const firstBot = botCatalog.keys().next().value ?? '';
  for (const seat of ['A', 'B', 'C']) {
    const stored = setup.bots[seat];
    const preferred = seat === 'B' ? 'laika' : 'gpt-dots';
    el[`seat-bot-${seat}`].value = botCatalog.has(stored) ? stored
      : seat === 'C' ? '' : botCatalog.has(preferred) ? preferred : firstBot;
  }
}

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
      select.disabled = false;
    }
    applyBotSelections();
    status.hidden = true;
  } catch (error) {
    status.textContent = `无法读取机器人目录（${error.message}）。修正后可刷新重试，本地多人仍可开局。`;
  } finally {
    rebuildCustomSeats();
  }
}

function optionValue(option) {
  const element = el[option.id];
  if (typeof option.initial === 'boolean') return Boolean(element.checked);
  if (typeof option.initial === 'number') return element.value ? Number(element.value) : NaN;
  return element.value;
}

function applyOption(option) {
  const value = setup.options[option.key] ?? option.serverDefault ?? option.initial;
  if (typeof value === 'boolean') el[option.id].checked = value;
  else el[option.id].value = String(value);
}

function updateMapPreview() {
  const preview = el['map-size-preview'];
  const autoSize = el['map-size-mode'].value === 'auto';
  const autoDensity = el['maze-complexity'].value === 'auto';
  preview.hidden = !autoSize && !autoDensity && !Object.keys(autoPickupProfiles).length;
  if (preview.hidden) return;
  const rosterText = count => {
    const size = autoSize && autoMapSizes[count];
    const density = autoDensity && densityLabel[autoMazeDensities[count]];
    const pickups = autoPickupProfiles[count];
    const pickupText = pickups ? `道具约 ${pickups.minSeconds}–${pickups.maxSeconds} 秒，场上限 ${pickups.maxOnField} 个` : '';
    return [size ? `${size.cols}×${size.rows}` : '', density || '', pickupText].filter(Boolean).join(' · ');
  };
  const enabled = [...customSeats.values()].filter(({ select }) => select.value !== '').length;
  const custom = rosterText(enabled);
  const presets = [2, 3].flatMap(count => rosterText(count) ? [`${count} 席 ${rosterText(count)}`] : []);
  preview.textContent = [custom ? `自定义：${enabled} 席，${custom}` : '按实际上场人数自动选择',
    presets.length ? `快捷开局：${presets.join('；')}` : ''].filter(Boolean).join('。');
}

for (const option of matchOptions) {
  applyOption(option);
  el[option.id].addEventListener('input', () => {
    const value = optionValue(option);
    if (validOption(value, option)) {
      setup.options[option.key] = value;
      saveSetup(setup);
    }
    if (['mapSizeMode', 'mazeComplexity'].includes(option.key)) queueDraw();
  });
}
for (const seat of ['A', 'B', 'C']) {
  el[`seat-bot-${seat}`].addEventListener('change', () => {
    setup.bots[seat] = el[`seat-bot-${seat}`].value;
    saveSetup(setup);
    queueDraw();
  });
}
function applyNames() {
  for (const id of seatIds) el[`seat-name-${id}`].value = setup.names[id] ?? '';
}
applyNames();
el['team-mode'].checked = setup.teamMode;
for (const id of seatIds) {
  const input = el[`seat-name-${id}`];
  input.addEventListener('input', () => {
    const value = tidyName(input.value);
    if (Array.from(value).length <= MAX_SEAT_NAME_LENGTH) {
      setup.names[id] = value;
      saveSetup(setup);
    }
  });
}
el['reset-setup'].addEventListener('click', () => {
  setup = sanitizeSetup();
  clearSetup();
  el.seed.value = '';
  for (const option of matchOptions) applyOption(option);
  el['team-mode'].checked = false;
  applyNames();
  applyBotSelections();
  rebuildCustomSeats();
});

async function loadMatchOptions() {
  try {
    const response = await fetch('/api/options', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const defaults = await response.json();
    for (const option of matchOptions) {
      const value = defaults?.[option.key];
      if (!validOption(value, option)) continue;
      option.serverDefault = value;
      if (!Object.hasOwn(setup.options, option.key)) applyOption(option);
    }
    for (let count = 2; count <= 8; count++) {
      const pickups = defaults?.autoPickupProfiles?.[count];
      if (Number.isFinite(pickups?.minSeconds) && pickups.minSeconds >= 0 &&
          Number.isFinite(pickups.maxSeconds) && pickups.maxSeconds >= pickups.minSeconds &&
          Number.isSafeInteger(pickups.maxOnField) && pickups.maxOnField > 0) {
        autoPickupProfiles[count] = pickups;
      }
      const density = defaults?.autoMazeDensities?.[count];
      if (Object.hasOwn(densityLabel, density)) autoMazeDensities[count] = density;
      const size = defaults?.autoMapSizes?.[count];
      if (size && ['cols', 'rows'].every(key => validOption(size[key], matchOptions.find(option => option.key === key)))) {
        autoMapSizes[count] = { cols: size.cols, rows: size.rows };
      }
    }
    queueDraw();
  } catch {
    // Keep usable settings while the local server is temporarily unreachable.
  }
}
void loadMatchOptions();

const replayStorageRoute = '/api/replay-storage';
const replayStorageForm = document.getElementById('replay-storage-form');
const replayDirectoryInput = document.getElementById('replay-directory');
const replayStorageStatus = document.getElementById('replay-storage-status');
const saveReplayDirectory = document.getElementById('save-replay-directory');
const resetReplayDirectory = document.getElementById('reset-replay-directory');
let storageBusy = false;

function pendingReplayStorage(pending) {
  storageBusy = pending;
  replayDirectoryInput.disabled = saveReplayDirectory.disabled = resetReplayDirectory.disabled = pending;
}

function showReplayStorage(current) {
  replayDirectoryInput.value = current.directory;
  replayStorageStatus.textContent = [
    current.warning, `${current.custom ? '已设置' : '启动默认目录'}：${current.directory}`
  ].filter(Boolean).join(' ');
}

async function loadReplayStorage() {
  pendingReplayStorage(true);
  try {
    const response = await fetch(replayStorageRoute, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    showReplayStorage(await response.json());
  } catch (error) {
    replayStorageStatus.textContent = `无法读取回放目录（${error.message}）。可以重填后保存。`;
  } finally {
    pendingReplayStorage(false);
  }
}

async function updateReplayStorage(directory) {
  if (storageBusy) return;
  pendingReplayStorage(true);
  replayStorageStatus.textContent = '正在保存回放目录…';
  try {
    showReplayStorage(await post(replayStorageRoute, { directory }));
  } catch (error) {
    replayStorageStatus.textContent = `未能确认保存：${error.message}。刷新可核对当前设置。`;
  } finally {
    pendingReplayStorage(false);
  }
}

replayStorageForm.addEventListener('submit', event => {
  event.preventDefault();
  void updateReplayStorage(replayDirectoryInput.value);
});
resetReplayDirectory.addEventListener('click', () => { void updateReplayStorage(null); });
void loadReplayStorage();


el['match-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  if (starting || (live.manifest && !live.done)) return;
  if (!streamOpen) return setError('尚未连到裁判，请稍后重试。');
  const requested = event.submitter?.value;
  const mode = matchMode(requested) ? requested : 'human';
  const seed = el.seed.value === '' ? undefined : Number(el.seed.value);
  if (el.seed.validity?.badInput || (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff))) {
    return setError('种子必须是有效的非负整数。');
  }
  const mapSizeMode = el['map-size-mode'].value;
  const overrides = { mapSizeMode };
  for (const option of matchOptions) {
    const dimension = ['cols', 'rows'].includes(option.key);
    if (dimension && mapSizeMode === 'auto') continue;
    const value = optionValue(option);
    if (!validOption(value, option)) {
      return setError(option.values ? `请选择有效的${option.label}。`
        : `${option.label}必须是 ${option.min}–${option.max} 的整数。`);
    }
    if (dimension || option.key === 'mazeComplexity' || value !== (option.serverDefault ?? option.initial) || Object.hasOwn(setup.options, option.key)) {
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
  startupSnapshot = null;
  const attempt = {};
  startAttempt = attempt;
  setError('');
  setStatus('正在启动对局…');
  queueDraw(true);
  try {
    const response = await post('/api/match', {
      mode,
      ...(seed === undefined ? {} : { seed }),
      ...overrides,
      ...(botSeats.length ? { bots } : {}),
      ...(custom ? { seats: custom.seats } : {}),
      ...(custom?.teams ? { teams: custom.teams } : {}),
      ...(Object.keys(playerNames).length ? { playerNames } : {}),
    });
    if (startAttempt !== attempt) return; // SSE can start and even finish before the HTTP response is processed.
    if (typeof response?.matchId !== 'string') throw new Error('裁判未确认新对局。');
    attempt.matchId = response.matchId;
    queueDraw();
    attempt.timer = setTimeout(() => failStartAttempt(attempt, '等待新对局超时，请检查裁判连接。'), 20_000);
  } catch (error) {
    failStartAttempt(attempt, `开局失败：${error.message}`);
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
  return !menuVisible && !replay && !starting && !startupDismissed() && !live.done && !stopping ? live.manifest : null;
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
  const remote = tank?.weapon === 'remote' && tank.fragId
    ? state.bullets?.find(({ id }) => id === tank.fragId) : null;
  sendInput(seat, pointerAction(tank, pointerTarget, pointerPressed, remote, state?.profile?.remoteTurn));
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
new ResizeObserver(() => {
  paintedRecord = null;
  queueDraw();
}).observe(el.battle);
rebuildCustomSeats();
void loadBotCatalog();
queueDraw();
