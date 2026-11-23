import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {normalizePlayerName} from '../protocol/bot/player-name.js';

import {canonical,MATCH_FORMAT,MAX_MATCH_TICKS} from '../protocol/game/match-format.js';

export const stateHash = state => createHash('sha256').update(canonical(state)).digest('hex');
export const playerIds = seats => Object.keys(seats).sort();

const ORDINARY_BUDGET_SHARE=0.6;

function accept(game,submission) {
  const {value,error} = submission ?? {};
  let accepted = game.neutralAction(), fallback = error ?? null;
  if (!fallback) {
    try { accepted = game.validateAction(value); } catch { fallback = 'invalid_action'; }
  }
  return {submitted:value ?? null,accepted,fallback};
}

export async function runMatch({game,seats,seed,mode='bots',config={},maxTicks=3600,timeoutMs=50,realtime=false,record,botVersions={},matchId,signal,playerNames={},humanControls,inputInsightSeats=[]}) {
  const players = playerIds(seats);
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(maxTicks) || maxTicks < 1 ||
      maxTicks > MAX_MATCH_TICKS || !Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('invalid match limits');
  if (!Array.isArray(inputInsightSeats)||inputInsightSeats.some(id=>!players.includes(id))) throw new Error('invalid input insight seats');
  const insightSet=new Set(inputInsightSeats);
  const insight=players.filter(id=>insightSet.has(id));
  const ordinary=players.filter(id=>!insightSet.has(id));
  const manifest = {
    format:MATCH_FORMAT, protocol:1, game:game.id, rulesVersion:game.version, tickRate:game.tickRate,
    mode, realtime, timeoutMs, seed, config, players, maxTicks, botVersions,
    ...(matchId?{matchId}:{}), ...(humanControls?{humanControls}:{}),
    ...(insight.length?{inputInsight:{seats:insight,contract:'accepted-opponent-actions',timing:'same-tick-after-ordinary',
      ...(game.insightCapabilities?.length?{capabilities:[...game.insightCapabilities]}:{})}}:{})
  };
  try {
    let state = game.init({seed,config,players});
    const starts = await Promise.all(players.map(playerId => seats[playerId].start?.({
      type:'start', protocol:1, game:game.id, rulesVersion:game.version, playerId, tickRate:game.tickRate, config
    })));
    manifest.playerNames=Object.fromEntries(players.map((id,i)=>[
      id,normalizePlayerName(Object.hasOwn(playerNames,id)?playerNames[id]:null) ??
        normalizePlayerName(starts[i]?.name) ?? id
    ]));
    await record({type:'start',manifest,state,hash:stateHash(state),readiness:Object.fromEntries(players.map((id,i)=>[id,starts[i]?.error ?? 'ready']))});
    const period = 1000 / game.tickRate;
    let deadline = performance.now() + period;
    for (let tick = 0; tick < maxTicks; tick++) {
      if (signal?.aborted) {
        const result={winner:null,reason:'stopped'};
        await record({type:'end',result});
        return result;
      }
      const began = performance.now();
      if (realtime && began - deadline > 4 * period) deadline = began + period;
      const observed = players.map(playerId => game.observe(state, playerId));
      const messages=players.map((id,i)=>({type:'observe',tick,observation:observed[i]}));
      let submissions, staged;
      if (!insight.length) {
        // Unprivileged matches retain the original concurrent dispatch and pacing.
        const budget = realtime ? Math.max(1, Math.min(timeoutMs, deadline - performance.now())) : timeoutMs;
        submissions = await Promise.all(players.map((id,i)=>seats[id].act(messages[i],budget)));
      } else {
        const now=performance.now();
        // Both phases draw from one tick deadline. Normal replies may arrive
        // early; the insight seats can use the buffer they leave behind.
        const tickExpiry=Math.min(now+timeoutMs,realtime?deadline:Infinity);
        const ordinaryExpiry=now+Math.max(0,tickExpiry-now)*ORDINARY_BUDGET_SHARE;
        const collect=async(ids,expiry,opponentActions)=>{
          const hints=opponentActions!==undefined&&expiry-performance.now()>=1
            ?game.privilegedObservation?.(state):undefined;
          const replies=await Promise.all(ids.map(id=>{
            const view=messages[players.indexOf(id)];
            if (opponentActions!==undefined) {
              view.opponentActionsTick=tick;
              view.opponentActions=structuredClone(opponentActions);
              if (hints) for (const [key, value] of Object.entries(hints)) {
                if (!(key in view)) view[key]=structuredClone(value);
              }
            }
            const budget=Math.floor(expiry-performance.now());
            return budget<1?{error:'timeout'}:seats[id].act(view,budget);
          }));
          return ids.map((id,i)=>[id,accept(game,replies[i])]);
        };
        const ordinaryInputs=await collect(ordinary,ordinaryExpiry);
        const brief=Object.fromEntries(ordinaryInputs.map(([id,input])=>[id,input.accepted]));
        const insightInputs=await collect(insight,tickExpiry,brief);
        staged=new Map([...ordinaryInputs,...insightInputs]);
      }
      if (realtime) {
        const remaining = deadline - performance.now();
        if (remaining > 0) await delay(Math.ceil(remaining));
        deadline += period;
      }
      const input = Object.fromEntries(players.map((id,i)=>[id,staged?staged.get(id):accept(game,submissions[i])]));
      const actions = Object.fromEntries(players.map(id => [id,input[id].accepted]));
      const next = game.step(state,actions);
      if (next.state.tick !== tick + 1) throw new Error('game must advance exactly one tick');
      state = next.state;
      await record({type:'tick',tick,state,hash:stateHash(state),input,events:next.events});
      if (next.result) {
        await record({type:'end',result:next.result});
        return next.result;
      }
    }
    const result = {winner:null,reason:'tick_limit'};
    await record({type:'end',result});
    return result;
  } finally {
    for (const id of players) seats[id].close?.();
  }
}
