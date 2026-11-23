import tuning from '../../games/tank-trouble/classic-profile.json' with {type:'json'};

const integer=(min,max)=>value=>Number.isInteger(value)&&value>=min&&value<=max;
const mapModes=Object.freeze(['auto','manual']);
const autoMapSizes=Object.freeze(Object.fromEntries([
  [12,9],[12,10],[13,10],[14,10],[14,11],[15,11],[16,12]
].map(([cols,rows],index)=>[index+2,Object.freeze({cols,rows})])));
const hasDimensions=config=>Object.hasOwn(config,'cols')||Object.hasOwn(config,'rows');
const sizeMode=config=>config.mapSizeMode===undefined?(hasDimensions(config)?'manual':'auto'):config.mapSizeMode;
const settings={
  simulationRate:{value:tuning.defaultSimulationRate,valid:value=>tuning.simulationRates.includes(value)},
  shrinkAfterSeconds:{value:40,valid:integer(0,120)},
  shrinkDurationSeconds:{value:15,valid:integer(1,120)},
  roundLimit:{value:0,valid:integer(0,20)},
  cols:{value:12,valid:integer(4,16)},
  rows:{value:9,valid:integer(4,12)},
  mapSizeMode:{valid:value=>mapModes.includes(value)},
  mazeComplexity:{value:'classic',valid:value=>['open','classic','dense'].includes(value)},
  friendlyFire:{value:false,valid:value=>typeof value==='boolean'}
};

export function tankOptions(config={}) {
  const options=Object.fromEntries(Object.entries(settings).map(([key,spec])=>[key,config[key]??spec.value]));
  return {...options,mapSizeMode:sizeMode(config),autoMapSizes};
}

export function applyTankOptions(config,overrides) {
  const selected={...config};
  for (const [key,{valid}] of Object.entries(settings)) if (Object.hasOwn(overrides,key)) {
    const value=overrides[key];
    if (!valid(value)) throw new Error('invalid '+key);
    selected[key]=value;
  }
  if (!Object.hasOwn(overrides,'mapSizeMode')&&hasDimensions(overrides)) selected.mapSizeMode='manual';
  return selected;
}

export function resolveTankMapSize(config,seatCount) {
  const mode=sizeMode(config);
  if (!mapModes.includes(mode)) throw new Error('invalid mapSizeMode');
  const {mapSizeMode:_mapSizeMode,...engineConfig}=config;
  if (mode==='auto') {
    if (!Number.isInteger(seatCount)||!Object.hasOwn(autoMapSizes,seatCount)) throw new Error('choose 2–8 seats');
    return {...engineConfig,...autoMapSizes[seatCount]};
  }
  return {
    ...engineConfig,
    cols:Object.hasOwn(config,'cols')?config.cols:settings.cols.value,
    rows:Object.hasOwn(config,'rows')?config.rows:settings.rows.value
  };
}
