export function normalizePlayerName(value) {
  if (typeof value !== 'string') return null;
  const name = value.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '').trim().replace(/\s+/gu, ' ');
  return name ? [...name].slice(0,24).join('') : null;
}
