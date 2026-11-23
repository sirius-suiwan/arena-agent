import data from '../classic-profile.json' with {type:'json'};

export const CLASSIC_DATA=data;
export const CLASSIC_TICK_RATES=Object.freeze([...data.simulationRates]);
export const CLASSIC_FRAME_RATE=data.source.framesPerSecond;

export function classicProfile(tickRate) {
  if (!CLASSIC_TICK_RATES.includes(tickRate)) throw new RangeError('Classic tick rate must be 25, 30 or 60 Hz');
  const {movement,shell,weapons,crates,arena,render}=data;
  const timing=frames=>frames*tickRate/CLASSIC_FRAME_RATE;
  const velocity=pixels=>pixels*data.arenaCellPixels*CLASSIC_FRAME_RATE/data.source.cellPixels/tickRate;
  const turning=degrees=>degrees*Math.PI/180*CLASSIC_FRAME_RATE/tickRate;
  return Object.freeze({
    tickRate,
    forwardSpeed:velocity(movement.forwardPixelsPerSourceFrame),
    reverseSpeed:velocity(movement.reversePixelsPerSourceFrame),
    turnSpeed:turning(movement.turnDegreesPerSourceFrame),
    shellSpeed:velocity(shell.pixelsPerSourceFrame),
    shellTtl:timing(shell.lifeSourceFrames),
    shellLimit:shell.arenaLiveShells,
    settleTicks:arena.settlementSeconds*tickRate,
    intermissionTicks:arena.intermissionSeconds*tickRate,
    zoneGraceTicks:arena.zoneGraceSeconds*tickRate,
    crateLimit:crates.maxOnField,
    gatlingSpeed:velocity(weapons.gatling.pixelsPerSourceFrame),
    gatlingTtl:timing(weapons.gatling.lifeSourceFrames),
    gatlingAmmo:weapons.gatling.ammo,
    gatlingSpin:timing(weapons.gatling.spinSourceFrames),
    gatlingGap:timing(weapons.gatling.gapSourceFrames),
    gatlingSpinDown:timing(weapons.gatling.spinDownBaseSourceFrames),
    gatlingSpread:weapons.gatling.spreadDegrees*Math.PI/180,
    laserSpeed:velocity(weapons.laser.pixelsPerSourceFrame),
    laserTtl:timing(weapons.laser.lifeSourceFrames),
    laserGuide:weapons.laser.guideCells*data.arenaCellPixels,
    deathRayCharge:timing(weapons.deathRay.chargeSourceFrames),
    deathRayActive:timing(weapons.deathRay.activeSourceFrames),
    missileSpeed:velocity(weapons.missile.pixelsPerSourceFrame),
    missileTtl:timing(weapons.missile.lifeSourceFrames),
    missileDelay:timing(weapons.missile.homingDelaySourceFrames),
    missileTurn:arena.homingSteerDegreesPerSecond*Math.PI/180/tickRate,
    remoteTurn:turning(weapons.missile.remoteDegreesPerSourceFrame),
    mineAmmo:weapons.mine.ammo,
    mineArm:timing(weapons.mine.armSourceFrames),
    mineFuse:timing(weapons.mine.fuseSourceFrames),
    fragmentCount:weapons.fragment.count,
    fragmentSpeed:arena.fragmentPixelsPerSecond/tickRate,
    fragmentTtl:arena.fragmentLifeSeconds*tickRate,
    render:Object.freeze({...render})
  });
}
