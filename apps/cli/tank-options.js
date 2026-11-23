import tuning from '../../games/tank-trouble/classic-profile.json' with {type:'json'};

const integer=(min,max)=>value=>Number.isInteger(value)&&value>=min&&value<=max;
const settings={
  simulationRate:{value:tuning.defaultSimulationRate,valid:value=>tuning.simulationRates.includes(value)},
  shrinkAfterSeconds:{value:40,valid:integer(0,120)},
  shrinkDurationSeconds:{value:15,valid:integer(1,120)},
  roundLimit:{value:0,valid:integer(0,20)},
  cols:{value:12,valid:integer(4,16)},
  rows:{value:9,valid:integer(4,12)},
  mazeComplexity:{value:'classic',valid:value=>['open','classic','dense'].includes(value)},
  friendlyFire:{value:false,valid:value=>typeof value==='boolean'}
};

export function tankOptions(config={}) {
  return Object.fromEntries(Object.entries(settings).map(([key,spec])=>[key,config[key]??spec.value]));
}

export function applyTankOptions(config,overrides) {
  const selected={...config};
  for (const [key,{valid}] of Object.entries(settings)) if (Object.hasOwn(overrides,key)) {
    const value=overrides[key];
    if (!valid(value)) throw new Error('invalid '+key);
    selected[key]=value;
  }
  return selected;
}
