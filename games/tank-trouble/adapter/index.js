import { init, step, TICK_RATE } from '../engine/engine.js';
import * as classic from '../engine/classic.js';
import {withClassicSeries} from '../series/index.js';

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

export const game = withClassicSeries(classicRoundGameV3);
