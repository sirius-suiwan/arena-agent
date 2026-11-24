import data from '../classic-profile.json' with {type:'json'};

export const CLASSIC_DATA=data;
export const CLASSIC_TICK_RATES=Object.freeze([...data.simulationRates]);
export const CLASSIC_FRAME_RATE=data.source.framesPerSecond;

export function classicProfile(tickRate) {
  if (!CLASSIC_TICK_RATES.includes(tickRate)) throw new RangeError('Classic tick rate must be 25, 30 or 60 Hz');
  const {movement,shell,weapons,arena,render}=data;
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
    muzzleOffset:shell.muzzleCells*data.arenaCellPixels,
    shellLimit:shell.arenaLiveShells,
    settleTicks:arena.settlementSeconds*tickRate,
    intermissionTicks:arena.intermissionSeconds*tickRate,
    zoneGraceTicks:arena.zoneGraceSeconds*tickRate,
    gatlingSpeed:velocity(weapons.gatling.pixelsPerSourceFrame),
    gatlingTtl:timing(weapons.gatling.lifeSourceFrames),
    gatlingAmmo:weapons.gatling.ammo,
    gatlingSpin:timing(weapons.gatling.spinSourceFrames),
    gatlingGap:timing(weapons.gatling.gapSourceFrames),
    gatlingSpinDown:timing(weapons.gatling.spinDownBaseSourceFrames),
    gatlingSpread:weapons.gatling.spreadDegrees*Math.PI/180,
    gatlingSafeTicks:timing(weapons.gatling.safeSourceFrames),
    gatlingRadius:weapons.gatling.collisionRadius,
    laserSpeed:velocity(weapons.laser.pixelsPerSourceFrame),
    laserTtl:timing(weapons.laser.lifeSourceFrames),
    laserGuide:weapons.laser.guideCells*data.arenaCellPixels,
    laserLaunchSafe:weapons.laser.launchSafePixels*data.arenaCellPixels/data.source.cellPixels,
    laserGuideSafe:weapons.laser.guideSafePixels*data.arenaCellPixels/data.source.cellPixels,
    laserFade:Math.ceil(timing(weapons.laser.fadeSourceFrames)),
    laserTrailPoints:weapons.laser.trailPoints,
    deathRayCharge:timing(weapons.deathRay.chargeSourceFrames),
    deathRayActive:timing(weapons.deathRay.activeSourceFrames),
    deathRayFade:Math.ceil(timing(weapons.deathRay.fadeSourceFrames)),
    deathRayMinRadius:weapons.deathRay.minRadiusCells*data.arenaCellPixels,
    deathRaySegment:weapons.deathRay.segmentCells*data.arenaCellPixels,
    deathRayMargin:weapons.deathRay.boundaryInsetCells*data.arenaCellPixels,
    deathRayWidth:weapons.deathRay.maxWidthSourcePixels*data.arenaCellPixels/data.source.cellPixels,
    deathRayWidthRamp:timing(weapons.deathRay.maxWidthSourcePixels),
    missileSpeed:velocity(weapons.missile.pixelsPerSourceFrame),
    missileTtl:timing(weapons.missile.lifeSourceFrames),
    missileDelay:timing(weapons.missile.homingDelaySourceFrames),
    missileSubsteps:Math.ceil(weapons.missile.guidanceIntervals*CLASSIC_FRAME_RATE/tickRate),
    missileAcceleration:velocity(weapons.missile.homingSourceImpulse*weapons.missile.guidanceIntervals)*CLASSIC_FRAME_RATE/tickRate,
    remoteAcceleration:velocity(weapons.missile.pixelsPerSourceFrame)*weapons.missile.remoteSourceImpulseRatio*CLASSIC_FRAME_RATE/tickRate,
    remoteTurn:turning(weapons.missile.remoteDegreesPerSourceFrame),
    mineAmmo:weapons.mine.ammo,
    mineArm:timing(weapons.mine.armSourceFrames),
    mineFuse:timing(weapons.mine.fuseSourceFrames),
    mineSpeed:velocity(weapons.mine.pixelsPerSourceFrame),
    mineDamping:weapons.mine.dampingPerSourceFrame**(CLASSIC_FRAME_RATE/tickRate),
    mineMoveFactor:(1-weapons.mine.dampingPerSourceFrame**(CLASSIC_FRAME_RATE/tickRate))/
      ((1-weapons.mine.dampingPerSourceFrame)*CLASSIC_FRAME_RATE/tickRate),
    mineStop:velocity(weapons.mine.stopSourcePixelsPerFrame),
    mineContactRadius:weapons.mine.contactRadiusCells*data.arenaCellPixels,
    mineVisibilityStep:weapons.mine.visibilityStepPerSourceFrame*CLASSIC_FRAME_RATE/tickRate,
    fragmentCount:weapons.fragment.count,
    // Original fragments check their center against the tank shape. Arena
    // substitutes its circular hull, not the cosmetic shard size.
    fragmentRadius:0,
    fragmentBaseSpeed:velocity(weapons.fragment.basePixelsPerSourceFrame),
    fragmentSpreadSpeed:velocity(weapons.fragment.spreadPixelsPerSourceFrame),
    fragmentFadeSeconds:weapons.fragment.fadeSourceFrames/CLASSIC_FRAME_RATE,
    render:Object.freeze({...render})
  });
}
