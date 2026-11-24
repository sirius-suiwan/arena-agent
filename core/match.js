import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {normalizePlayerName} from '../protocol/bot/player-name.js';

import {canonical,MATCH_FORMAT,MAX_MATCH_TICKS} from '../protocol/game/match-format.js';

export const stateHash = state => createHash('sha256').update(canonical(state)).digest('hex');
export const playerIds = seats => Object.keys(seats).sort();

function accept(game,submission) {
  const {value,error} = submission ?? {};
  let accepted = game.neutralAction(), fallback = error ?? null;
  if (!fallback) {
    try { accepted = game.validateAction(value); } catch { fallback = 'invalid_action'; }
  }
  return {submitted:value ?? null,accepted,fallback};
}

export async function runMatch({game,seats,seed,mode='bots',config={},maxTicks=3600,timeoutMs=50,realtime=false,record,botVersions={},matchId,signal,playerNames={},humanControls,privilegedSeats=[],onSeatReady,beforeStart,diagnostics}) {
  const players = playerIds(seats);
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(maxTicks) || maxTicks < 1 ||
      maxTicks > MAX_MATCH_TICKS || !Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('invalid match limits');
  if (!Array.isArray(privilegedSeats)||privilegedSeats.some(id=>!players.includes(id))) throw new Error('invalid privileged seats');
  const insightSet=new Set(privilegedSeats);
  const insight=players.filter(id=>insightSet.has(id));
  const capabilities=insight.length?(game.insightCapabilitiesForConfig?.(config)??game.insightCapabilities):null;
  const manifest = {
    format:MATCH_FORMAT, protocol:1, game:game.id, rulesVersion:game.version, tickRate:game.tickRate,
    mode, realtime, timeoutMs, seed, config, players, maxTicks, botVersions,
    ...(matchId?{matchId}:{}), ...(humanControls?{humanControls}:{}),
    ...(insight.length?{inputInsight:{seats:insight,timing:'concurrent',
      ...(capabilities?.length?{capabilities:[...capabilities]}:{})}}:{})
  };
  try {
    const initAt=diagnostics&&performance.now();
    let state = game.init({seed,config,players});
    diagnostics?.startup('initMs',performance.now()-initAt);
    const starts = Object.fromEntries(await Promise.all(players.map(async playerId=>{
      let response;
      const handshakeAt=diagnostics&&performance.now();
      try {
        response=await seats[playerId].start?.({
          type:'start', protocol:1, game:game.id, rulesVersion:game.version, playerId, tickRate:game.tickRate, config
        },{signal});
      } catch(error) {
        // CLI callers keep the existing throw contract. Interactive startup
        // reports a failed seat rather than waiting on unexplained silence.
        if(!beforeStart) throw error;
        response={error:'startup_error'};
      }
      const name=normalizePlayerName(Object.hasOwn(playerNames,playerId)?playerNames[playerId]:null)
        ??normalizePlayerName(response?.name)??playerId;
      const status=response?.error??'ready';
      diagnostics?.ready(playerId,status,performance.now()-handshakeAt);
      onSeatReady?.(playerId,{name,status});
      return [playerId,{name,status}];
    })));
    manifest.playerNames=Object.fromEntries(players.map(id=>[id,starts[id].name]));
    const readiness=Object.fromEntries(players.map(id=>[id,starts[id].status]));
    const gateAt=diagnostics&&performance.now();
    const startupResult=beforeStart?await beforeStart(readiness):null;
    diagnostics?.startup('gateMs',performance.now()-gateAt);
    const recordStartAt=diagnostics&&performance.now();
    await record({type:'start',manifest,state,hash:stateHash(state),readiness});
    diagnostics?.startup('recordStartMs',performance.now()-recordStartAt);
    if(startupResult) {
      await record({type:'end',result:startupResult});
      return startupResult;
    }
    diagnostics?.beginCombat();
    const period = 1000 / game.tickRate;
    let deadline = performance.now() + period, previousTickAt;
    for (let tick = 0; tick < maxTicks; tick++) {
      if (signal?.aborted) {
        const result={winner:null,reason:'stopped'};
        await record({type:'end',result});
        return result;
      }
      const began = performance.now();
      if(diagnostics&&previousTickAt!==undefined) diagnostics.sample('tickIntervalMs',began-previousTickAt);
      if(diagnostics) previousTickAt=began;
      if (realtime && began - deadline > 4 * period) {
        deadline = began + period;
        diagnostics?.count('deadlineResyncs');
      }
      const hintAt=diagnostics&&performance.now();
      const hints=insight.length?game.privilegedObservation?.(state):undefined;
      const observedAt=diagnostics&&performance.now();
      const messages=players.map(id=>{
        const view={type:'observe',tick,observation:game.observe(state,id)};
        if (hints&&insightSet.has(id)) for (const [key,value] of Object.entries(hints)) {
          if (!(key in view)) view[key]=structuredClone(value);
        }
        return view;
      });
      // Private hints depend only on the starting state, never another seat's
      // input. Every seat is dispatched together with the same full budget.
      const dispatchAt=realtime||diagnostics?performance.now():null;
      const remainingAtDispatch=deadline-dispatchAt;
      const budget=realtime?Math.max(1,Math.min(timeoutMs,remainingAtDispatch)):timeoutMs;
      const timings=diagnostics?[]:null;
      const submissions=await Promise.all(players.map((id,i)=>{
        if(!timings) return seats[id].act(messages[i],budget);
        const at=performance.now();
        return Promise.resolve(seats[id].act(messages[i],budget)).then(response=>{
          timings[i]=[performance.now()-at,at-dispatchAt];
          return response;
        });
      }));
      const actionsAt=diagnostics&&performance.now();
      const input = Object.fromEntries(players.map((id,i)=>[id,accept(game,submissions[i])]));
      const actions = Object.fromEntries(players.map(id => [id,input[id].accepted]));
      const stepAt=diagnostics&&performance.now();
      const next = game.step(state,actions);
      if (next.state.tick !== tick + 1) throw new Error('game must advance exactly one tick');
      state = next.state;
      // Use the slack after all replies to step and hash this frame. Holding
      // the finished frame until its deadline preserves spectator pacing,
      // while avoiding charging this work to the next shared decision window.
      const hashAt=diagnostics&&performance.now();
      const frame={type:'tick',tick,state,hash:stateHash(state),input,events:next.events};
      const waitAt=diagnostics&&performance.now();
      const targetDeadline=deadline;
      if (realtime) {
        const remaining = deadline - performance.now();
        if (remaining > 0) await delay(Math.ceil(remaining));
        deadline += period;
      }
      const recordAt=diagnostics&&performance.now();
      await record(frame);
      if(diagnostics) {
        const recordDone=performance.now();
        diagnostics.count('ticks');
        if(realtime&&remainingAtDispatch<1) diagnostics.count('budgetFloorTicks');
        for(const [key,value] of [
          ['hintMs',observedAt-hintAt],['observationMs',dispatchAt-observedAt],['dispatchBudgetMs',budget],
          ['preDispatchLatenessMs',realtime?Math.max(0,-remainingAtDispatch):0],['botWaitMs',actionsAt-dispatchAt],
          ['validateActionsMs',stepAt-actionsAt],['stepMs',hashAt-stepAt],['hashMs',waitAt-hashAt],
          ['scheduleWaitMs',recordAt-waitAt],['recordAndPublishMs',recordDone-recordAt],
          ['publishDeadlineOverrunMs',realtime?Math.max(0,recordAt-targetDeadline):0],
          ['recordCompleteOverrunMs',realtime?Math.max(0,recordDone-targetDeadline):0]
        ]) diagnostics.sample(key,value);
        let timeouts=0;
        for(const [i,id] of players.entries()) {
          const [latency,offset]=timings[i];
          const {fallback}=input[id];
          if(fallback==='timeout') timeouts++;
          diagnostics.action(id,latency,offset,budget,fallback);
        }
        diagnostics.timeouts(timeouts);
      }
      if (next.result) {
        await record({type:'end',result:next.result});
        return next.result;
      }
    }
    const result = {winner:null,reason:'tick_limit'};
    await record({type:'end',result});
    return result;
  } finally {
    diagnostics?.endCombat();
    for (const id of players) seats[id].close?.();
  }
}
