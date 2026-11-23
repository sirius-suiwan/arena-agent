import { init, step, TICK_RATE } from '../engine/engine.js';
import * as classic from '../engine/classic.js';
import {CLASSIC_DATA,classicProfile} from '../engine/profile-v8.js';
import {withClassicSeries,withClassicSeriesV7} from '../series/index.js';
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

export const gameV1 = Object.freeze({
  id: 'tank-trouble',
  version: '1',
  tickRate: TICK_RATE,
  init,
  observe(state, playerId) {
    if (!state.tanks.some(t=>t.id===playerId)) throw new Error('unknown player ID');
    const {tick,width,height,walls,tanks,bullets,pickups,result}=state;
    return {tick,playerId,width,height,walls:walls.map(w=>({...w})),tanks:tanks.map(t=>({...t})),
      bullets:bullets.map(b=>({...b})),pickups:pickups.map(p=>({...p})),result:result?{...result}:null};
  },
  validateAction,
  neutralAction() { return {throttle:0,turn:0,fire:false}; },
  step
});

export const classicRoundGame = Object.freeze({
  ...gameV1,
  version: '2',
  init: classic.init,
  observe(state, playerId) {
    const obs=gameV1.observe(state,playerId);
    return {...obs,tanks:obs.tanks.map(t=>({...t,aimGuide:t.aimGuide?.map(point=>({...point}))??null})),
      mines:state.mines.map(m=>({...m})),settleUntil:state.settleUntil};
  },
  step: classic.step
});

export const gameV2 = withClassicSeries(classicRoundGame);

export const classicRoundGameV3 = Object.freeze({
  ...classicRoundGame,
  version: '3',
  init: classic.initV3,
  observe(state, playerId) {
    return {...classicRoundGame.observe(state,playerId),pickupBlocks:state.pickupBlocks.map(block=>({...block}))};
  },
  step: classic.stepV3
});

export const gameV3 = withClassicSeries(classicRoundGameV3);

export const classicRoundGameV4 = Object.freeze({
  ...classicRoundGameV3,
  version: '4',
  init: classic.initV4,
  observe(state,playerId) {
    return {...classicRoundGameV3.observe(state,playerId),shellSpeed:state.config.shellSpeed,shellLimit:state.shellLimit};
  },
  step: classic.stepV4
});

export const gameV4 = withClassicSeries(classicRoundGameV4);

export const classicRoundGameV5 = Object.freeze({
  ...classicRoundGameV4,
  version: '5',
  init: classic.initV5
});

export const gameV5 = withClassicSeries(classicRoundGameV5);

export const classicRoundGameV6 = Object.freeze({
  ...classicRoundGameV5,
  version: '6',
  init: classic.initV6,
  step: classic.stepV6,
  matchTickLimit: classic.matchTickLimitV6,
  observe(state,playerId) {
    return {...classicRoundGameV5.observe(state,playerId),
      zone:{...state.zone,outsideTicks:{...state.zone.outsideTicks}}};
  }
});

export const gameV6 = withClassicSeries(classicRoundGameV6);

export const classicRoundGameV7 = Object.freeze({
  ...classicRoundGameV6,
  version: '7',
  init: classic.initV7,
  validateTeams: classic.validateTeams,
  roundTickLimit: classic.roundTickLimitV7,
  matchTickLimit: classic.matchTickLimitV7,
  observe(state,playerId) {
    return {...classicRoundGameV6.observe(state,playerId),friendlyFire:state.friendlyFire,
      ...(state.teams?{teams:{...state.teams}}:{})};
  }
});

export const gameV7 = withClassicSeriesV7(classicRoundGameV7);

function makeClassicV8(tickRate) {
  const profile=classicProfile(tickRate);
  const round=Object.freeze({
    ...classicRoundGameV7,
    version:'8-'+tickRate,
    tickRate,
    init:input=>classic.initV8(input,tickRate),
    step:classic.stepV8,
    roundTickLimit:config=>classic.roundTickLimitV8(config,tickRate),
    matchTickLimit:config=>classic.matchTickLimitV8(config,tickRate),
    observe(state,playerId) {
      return {...classicRoundGameV7.observe(state,playerId),profile:{...state.profile}};
    }
  });
  return withClassicSeriesV7(round,{breakTicks:profile.intermissionTicks,settlementTicks:profile.settleTicks,
    defaultMatchTicks:140*tickRate});
}

export const gameV8_25 = makeClassicV8(25);
export const gameV8_30 = makeClassicV8(30);
export const gameV8_60 = makeClassicV8(60);
export const game = [gameV8_25,gameV8_30,gameV8_60].find(g=>g.tickRate===CLASSIC_DATA.defaultSimulationRate);
