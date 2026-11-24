import * as classic from '../engine/classic.js';
import {CLASSIC_DATA,CLASSIC_TICK_RATES,classicProfile} from '../engine/profile.js';
import {withClassicSeries} from '../series/index.js';
export {validateTeams} from '../engine/classic.js';

function validateAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action) ||
      Object.keys(action).length !== 3 || !Object.hasOwn(action,'throttle') ||
      !Object.hasOwn(action,'turn') || !Object.hasOwn(action,'fire') ||
      ![-1,0,1].includes(action.throttle) || ![-1,0,1].includes(action.turn) ||
      typeof action.fire !== 'boolean') {
    throw new TypeError('action must be { throttle: -1|0|1, turn: -1|0|1, fire: boolean }');
  }
  return {throttle:action.throttle,turn:action.turn,fire:action.fire};
}

// Keep the bot protocol comfortably below its per-line cap even if all
// eight tanks activate a death ray together. The exact dense path stays
// in the state and authoritative events used by rendering/replay.
function tankObservation({beamPath,...t}) {
  const view={...t,aimGuide:t.aimGuide?.map(point=>({...point}))??null};
  if(beamPath) {
    const stride=Math.max(1,Math.ceil((beamPath.length-1)/63));
    view.beamPath=beamPath.filter((_,i)=>i===beamPath.length-1||i%stride===0).map(point=>({...point}));
  }
  return view;
}

function observe(state,playerId) {
  if (!state.tanks.some(t=>t.id===playerId)) throw new Error('unknown player ID');
  const {tick,width,height,walls,tanks,bullets,pickups,result,mines,settleUntil,pickupBlocks,shellLimit,zone,friendlyFire,teams,profile}=state;
  return {
    tick,playerId,width,height,
    walls:walls.map(w=>({...w})),
    tanks:tanks.map(tankObservation),
    bullets:bullets.map(b=>({...b,...(b.path?{path:b.path.map(point=>({...point}))}:{})})),
    pickups:pickups.map(p=>({...p})),
    result:result?{...result}:null,
    mines:mines.filter(m=>m.visibility!==0).map(m=>({...m})),
    settleUntil,
    pickupBlocks:pickupBlocks.map(block=>({...block})),
    shellSpeed:state.config.shellSpeed,
    shellLimit,
    zone:{...zone,outsideTicks:{...zone.outsideTicks}},
    friendlyFire,
    ...(teams?{teams:{...teams}}:{}),
    profile:{...profile}
  };
}

function makeClassic(tickRate) {
  const profile=classicProfile(tickRate);
  const round=Object.freeze({
    id:'tank-trouble',
    version:'9-'+tickRate,
    tickRate,
    init:input=>classic.init(input,tickRate),
    observe,
    insightCapabilitiesForConfig:config=>config.shrinkCenter==='random'
      ? ['pickup-forecast','shrink-destination'] : ['pickup-forecast'],
    privilegedObservation(state) {
      const pickupForecast=classic.pickupForecast(state);
      const {zoneDestination:destination,zone,roundTick,phase,settleUntil}=state;
      const shrinkDestination=destination&&phase==='playing'&&settleUntil===null&&roundTick<=zone.endTick
        ? {x:destination.x,y:destination.y,startsAt:zone.startTick,endsAt:zone.endTick} : null;
      if(!pickupForecast&&!shrinkDestination) return undefined;
      return {...(pickupForecast?{pickupForecast}:{}),...(shrinkDestination?{shrinkDestination}:{})};
    },
    spectateState({zoneDestination:_private,...state}) { return state; },
    validateAction,
    neutralAction() { return {throttle:0,turn:0,fire:false}; },
    step:classic.step,
    validateTeams:classic.validateTeams,
    roundTickLimit:config=>classic.roundTickLimit(config,tickRate),
    matchTickLimit:config=>classic.matchTickLimit(config,tickRate)
  });
  return withClassicSeries(round,{breakTicks:profile.intermissionTicks,settlementTicks:profile.settleTicks,
    defaultMatchTicks:140*tickRate});
}

export const gamesByRate=Object.freeze(Object.fromEntries(CLASSIC_TICK_RATES.map(rate=>[rate,makeClassic(rate)])));
export function gameForRate(tickRate) {
  if (!CLASSIC_TICK_RATES.includes(tickRate)) throw new RangeError('Classic tick rate must be 25, 30 or 60 Hz');
  return gamesByRate[tickRate];
}
export const game=gameForRate(CLASSIC_DATA.defaultSimulationRate);
