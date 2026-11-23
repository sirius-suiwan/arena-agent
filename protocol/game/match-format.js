// Shared by the match host and deterministic replay readers (including browsers).
export const MATCH_FORMAT = 2;
export const MAX_MATCH_TICKS = 300_000;

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
