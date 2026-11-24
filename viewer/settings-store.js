const KEY = 'arena-agent.setup.v1';
const seats = [...'ABCDEFGH'];
const botId = /^[a-z][a-z0-9-]{0,47}$/;
const controls = new Set(['arrows', 'esdf', 'mouse']);

export const matchOptionDefinitions = [
  { id: 'map-size-mode', key: 'mapSizeMode', values: ['auto', 'manual'], initial: 'auto', label: '地图大小' },
  { id: 'simulation-rate', key: 'simulationRate', values: [25, 30, 60], initial: 25, label: '模拟频率' },
  { id: 'round-limit', key: 'roundLimit', min: 0, max: 20, initial: 0, label: '总局数' },
  { id: 'maze-cols', key: 'cols', min: 4, max: 16, initial: 12, label: '地图列数' },
  { id: 'maze-rows', key: 'rows', min: 4, max: 12, initial: 9, label: '地图行数' },
  { id: 'maze-complexity', key: 'mazeComplexity', values: ['auto', 'open', 'classic', 'dense'], initial: 'auto', label: '迷宫复杂度' },
  { id: 'friendly-fire', key: 'friendlyFire', initial: false },
  { id: 'shrink-center', key: 'shrinkCenter', values: ['center', 'random'], initial: 'center', label: '缩圈终点' },
  { id: 'shrink-after', key: 'shrinkAfterSeconds', min: 0, max: 120, initial: 40, label: '缩圈开始时间' },
  { id: 'shrink-duration', key: 'shrinkDurationSeconds', min: 1, max: 120, initial: 15, label: '缩圈持续时间' },
];

export function validOption(value, option) {
  if (option.values) return option.values.includes(value);
  if (typeof option.initial === 'boolean') return typeof value === 'boolean';
  return Number.isInteger(value) && value >= option.min && value <= option.max;
}

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const tidyName = value => value.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '').trim().replace(/\s+/gu, ' ');

function selected(entries, keys, valid) {
  const source = record(entries);
  return Object.fromEntries(keys.flatMap(key => Object.hasOwn(source, key) && valid(source[key], key)
    ? [[key, source[key]]] : []));
}

export function sanitizeSetup(value) {
  const data = record(value);
  const options = record(data.options);
  const occupied = new Set();
  return {
    options: Object.fromEntries(matchOptionDefinitions.flatMap(option =>
      validOption(options[option.key], option) ? [[option.key, options[option.key]]] : [])),
    bots: selected(data.bots, ['A', 'B', 'C'], (id, seat) =>
      typeof id === 'string' && ((seat === 'C' && id === '') || botId.test(id))),
    seats: selected(data.seats, seats, value => {
      if (typeof value !== 'string') return false;
      if (!value || (value.startsWith('bot:') && botId.test(value.slice(4)))) return true;
      const control = value.startsWith('control:') && value.slice(8);
      if (!controls.has(control) || occupied.has(control)) return false;
      occupied.add(control);
      return true;
    }),
    teams: selected(data.teams, seats, value => ['1', '2', '3', '4'].includes(value)),
    names: Object.fromEntries(Object.entries(selected(data.names, seats, value =>
      typeof value === 'string' && Array.from(tidyName(value)).length <= 24)).map(([id, value]) => [id, tidyName(value)])),
    teamMode: typeof data.teamMode === 'boolean' ? data.teamMode : false,
  };
}

export function readSetup() {
  try { return sanitizeSetup(JSON.parse(globalThis.localStorage.getItem(KEY))); }
  catch { return sanitizeSetup(); }
}

export function saveSetup(value) {
  try { globalThis.localStorage.setItem(KEY, JSON.stringify(sanitizeSetup(value))); } catch { /* unavailable */ }
}

export function clearSetup() {
  try { globalThis.localStorage.removeItem(KEY); } catch { /* unavailable */ }
}
