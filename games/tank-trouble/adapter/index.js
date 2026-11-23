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

function observe(state,playerId) {
  if (!state.tanks.some(t=>t.id===playerId)) throw new Error('unknown player ID');
  const {tick,width,height,walls,tanks,bullets,pickups,result,mines,settleUntil,pickupBlocks,shellLimit,zone,friendlyFire,teams,profile}=state;
  return {
    tick,playerId,width,height,
    walls:walls.map(w=>({...w})),
    tanks:tanks.map(t=>({...t,aimGuide:t.aimGuide?.map(point=>({...point}))??null})),
    bullets:bullets.map(b=>({...b,...(b.path?{path:b.path.map(point=>({...point}))}:{})})),
    pickups:pickups.map(p=>({...p})),
    result:result?{...result}:null,
    mines:mines.map(m=>({...m})),
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
