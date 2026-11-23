import {
  drawTankFrame, validateTankFrame, formatTankEvent, drawScoreIcon, projectTankPointer,
  equippedTankWeapon, tankWeaponLabel, drawWeaponIcon,
} from '/games/tank-trouble/renderer/index.js';

export const renderers = Object.freeze({
  'tank-trouble': {
    draw: drawTankFrame, validate: validateTankFrame, formatEvent: formatTankEvent,
    scoreIcon: drawScoreIcon, equippedWeapon: equippedTankWeapon, weaponLabel: tankWeaponLabel,
    weaponIcon: drawWeaponIcon, projectPointer: projectTankPointer, title: '坦克迷宫战场',
  },
});
