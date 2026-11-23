import { availableShellSlots } from './score-data.js';
import {
  drawTankFrame, formatTankEvent, drawScoreIcon, projectTankPointer,
  equippedTankWeapon, tankWeaponLabel, drawWeaponIcon, tankSeatColor,
} from '/games/tank-trouble/renderer/index.js';

export const renderers = Object.freeze({
  'tank-trouble': {
    draw: drawTankFrame, formatEvent: formatTankEvent,
    scoreIcon: drawScoreIcon, seatColor: tankSeatColor, ammo: availableShellSlots, equippedWeapon: equippedTankWeapon, weaponLabel: tankWeaponLabel,
    weaponIcon: drawWeaponIcon, projectPointer: projectTankPointer, title: '坦克迷宫战场',
  },
});
