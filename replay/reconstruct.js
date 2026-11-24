import {canonical,MATCH_FORMAT,MAX_MATCH_TICKS} from '../protocol/game/match-format.js';

export {canonical};
export const MAX_REPLAY_LINE = 4 * 1024 * 1024;
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a,b) => canonical(a) === canonical(b);

// Browser and recorder Math implementations can differ by a few ULPs.
// Only allow tiny drift in spatial event fields, never in IDs, ticks or scores.
const SPATIAL_FIELDS = new Set(['x','y','vx','vy','endX','endY','width']);
const POSITION_TOLERANCE = 1e-7;
const nearPosition=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=POSITION_TOLERANCE;
function equivalentBeamPath(actual,recorded) {
  return Array.isArray(actual)&&Array.isArray(recorded)&&actual.length===recorded.length&&actual.every((p,i)=>{
    const q=recorded[i];
    return q&&typeof q==='object'&&!Array.isArray(q)&&Object.keys(q).length===2&&
      Object.hasOwn(q,'x')&&Object.hasOwn(q,'y')&&nearPosition(p.x,q.x)&&nearPosition(p.y,q.y);
  });
}
function equivalentPlaybackEvents(actual,recorded) {
  return Array.isArray(recorded) && actual.length === recorded.length && actual.every((event,i)=>{
    const other=recorded[i];
    if (!other || typeof other !== 'object' || Array.isArray(other)) return false;
    const keys=Object.keys(event);
    return keys.length === Object.keys(other).length && keys.every(key=>{
      if (!Object.hasOwn(other,key)) return false;
      const a=event[key], b=other[key];
      return same(a,b) || (SPATIAL_FIELDS.has(key)&&nearPosition(a,b)) ||
        (key==='path'&&(event.type==='laser-path'||event.type==='death-ray-beam'||
          event.type==='weapon-fired'&&event.weapon==='death-ray')&&equivalentBeamPath(a,b));
    });
  });
}

export function parseReplayLine(line) {
  if (line.length > MAX_REPLAY_LINE) throw new Error('replay line too large');
  try { return JSON.parse(line); }
  catch { throw new Error('invalid replay JSON'); }
}

export function createReplayReconstructor(resolveGame,{mode='strict'}={}) {
  let state, game, manifest, expected, tick = 0, ended = false;
  const check = (condition,message) => { if (!condition) throw new Error(`tick ${tick}: ${message}`); };
  return {
    push(record) {
      check(!ended,'unexpected data after end');
      check(record && typeof record === 'object','invalid record');
      if (!manifest) {
        check(record.type === 'start' && record.manifest?.format === MATCH_FORMAT,'missing or unsupported start');
        manifest = record.manifest;
        check(Number.isSafeInteger(manifest.seed) &&
          Number.isSafeInteger(manifest.maxTicks) && manifest.maxTicks >= 1 && manifest.maxTicks <= MAX_MATCH_TICKS &&
          Array.isArray(manifest.players) && manifest.players.length > 0 &&
          manifest.players.every(id=>typeof id === 'string' && id.length > 0) &&
          new Set(manifest.players).size === manifest.players.length,'invalid manifest');
        game = resolveGame(manifest);
        check(game?.id === manifest.game && game.version === manifest.rulesVersion && game.tickRate === manifest.tickRate,
          'unknown rules version');
        check(isHash(record.hash),'invalid state hash');
        const {seed,config,players} = manifest;
        state = game.init({seed,config,players});
        return {...record,state};
      }
      if (record.type === 'tick') {
        check(!expected && tick < manifest.maxTicks && record.tick === tick,'out-of-order tick');
        check(isHash(record.hash),'invalid state hash');
        const actions = Object.fromEntries(manifest.players.map(id => {
          const entry = Object.hasOwn(record.input ?? {},id) && record.input[id];
          let action;
          check(entry && typeof entry === 'object' && Object.hasOwn(entry,'submitted') &&
            (entry.fallback === null || typeof entry.fallback === 'string'),'invalid input');
          try { action = game.validateAction(entry.accepted); }
          catch { check(false,'invalid accepted action'); }
          return [id,action];
        }));
        const next = game.step(state,actions);
        state = next.state;
        check(state.tick === tick + 1,'state tick differs');
        check(same(next.events,record.events) ||
          (mode === 'playback' && equivalentPlaybackEvents(next.events,record.events)),'events differ');
        expected = next.result;
        tick++;
        return {...record,state};
      }
      check(record.type === 'end','unexpected record type');
      expected ??= tick === manifest.maxTicks ? {winner:null,reason:'tick_limit'}
        : record.result?.reason === 'stopped' ? {winner:null,reason:'stopped'} : undefined;
      check(expected && same(expected,record.result),'result differs');
      ended = true;
      return record;
    },
    finish() {
      check(ended,'missing end');
      return {ticks:tick,result:expected};
    }
  };
}
