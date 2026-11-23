import { drawTankFrame, validateTankFrame, formatTankEvent } from '/games/tank-trouble/renderer/index.js';

export const renderers = Object.freeze({
  'tank-trouble': { draw: drawTankFrame, validate: validateTankFrame, formatEvent: formatTankEvent, title: '坦克迷宫战场' },
});
