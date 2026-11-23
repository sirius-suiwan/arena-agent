import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyTankOptions,resolveTankMapSize,tankOptions} from '../apps/cli/tank-options.js';
import {makeMatch} from '../apps/cli/match-options.js';
import {game} from '../games/tank-trouble/adapter/index.js';
import {jumpGame} from './fixtures/jump-game.js';

const dimensions={2:{cols:12,rows:9},3:{cols:12,rows:10},4:{cols:13,rows:10},5:{cols:14,rows:10},
  6:{cols:14,rows:11},7:{cols:15,rows:11},8:{cols:16,rows:12}};

test('automatic map sizes cover each occupied-seat count and expose exact options',()=>{
  const defaults=tankOptions();
  assert.equal(defaults.mapSizeMode,'auto');
  assert.deepEqual({cols:defaults.cols,rows:defaults.rows},dimensions[2]);
  assert.deepEqual(defaults.autoMapSizes,dimensions);
  for(const [n,size] of Object.entries(dimensions)) {
    assert.deepEqual(resolveTankMapSize({shrinkAfterSeconds:2},Number(n)),{shrinkAfterSeconds:2,...size});
  }
  assert.throws(()=>resolveTankMapSize({},1),/2–8 seats/);
  assert.throws(()=>resolveTankMapSize({},9),/2–8 seats/);
  assert.throws(()=>applyTankOptions({},{mapSizeMode:'giant'}),/invalid mapSizeMode/);
  assert.throws(()=>applyTankOptions({},{mapSizeMode:null}),/invalid mapSizeMode/);
});

test('manual and CLI dimensions preserve size while request auto overrides serve defaults',()=>{
  const serve=applyTankOptions({},{cols:6});
  assert.equal(tankOptions(serve).mapSizeMode,'manual');
  assert.deepEqual(resolveTankMapSize(serve,8),{cols:6,rows:9});
  assert.deepEqual(resolveTankMapSize({rows:6},8),{cols:12,rows:6});
  assert.deepEqual(resolveTankMapSize({mapSizeMode:'manual'},8),{cols:12,rows:9});
  assert.deepEqual(resolveTankMapSize(applyTankOptions(serve,{mapSizeMode:'auto'}),8),dimensions[8]);
  assert.deepEqual(resolveTankMapSize(applyTankOptions(serve,{mapSizeMode:'manual',rows:5}),8),{cols:6,rows:5});
  assert.deepEqual(resolveTankMapSize(applyTankOptions({mapSizeMode:'auto'},{cols:10,rows:6}),8),{cols:10,rows:6});
});

const botFixture=`
  const rl=require('node:readline').createInterface({input:process.stdin});
  rl.on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='start') console.log(JSON.stringify({type:'ready',protocol:1}));
    if(msg.type==='observe') console.log(JSON.stringify({
      type:'action',tick:msg.tick,action:{throttle:0,turn:0,fire:false}
    }));
  });
`;

test('match manifests and engine use occupied seats, not slot letters or registered bot count',async t=>{
  const root=await mkdtemp(join(tmpdir(),'arena-map-sizes-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'neutral.js');
  await writeFile(path,botFixture);
  const registry=new Map([['fixture',{id:'fixture',name:'Fixture',path}]]);
  const human=Object.fromEntries([...'ABCH'].map(id=>[id,{act:()=>({value:game.neutralAction()})}]));
  async function start(extra) {
    const records=[];
    const match=await makeMatch({game,root,base:root,seed:1,maxTicks:1,timeoutMs:1000,human,registry,
      recorder:()=>({write:row=>records.push(row),close:()=>{}}),...extra});
    await match.run();
    return records[0];
  }
  const assertSize=({manifest,state},seats,{cols,rows})=>{
    assert.deepEqual(manifest.players,[...seats]);
    assert.equal(manifest.config.cols,cols);
    assert.equal(manifest.config.rows,rows);
    assert.equal(Object.hasOwn(manifest.config,'mapSizeMode'),false);
    assert.equal(state.width,cols*64);
    assert.equal(state.height,rows*64);
    assert.deepEqual(game.init(manifest),state);
  };
  assertSize(await start({mode:'local3'}),'ABC',dimensions[3]);
  assertSize(await start({mode:'human',paths:{B:'fixture'}}),'AB',dimensions[2]);
  assertSize(await start({mode:'custom',roster:{A:{control:'arrows'},H:{bot:'fixture'}}}),'AH',dimensions[2]);
  assertSize(await start({mode:'custom',roster:{A:{control:'arrows'},C:{bot:'fixture'},F:{bot:'fixture'},H:{control:'mouse'}}}),'ACFH',dimensions[4]);
  assertSize(await start({paths:{A:'fixture',B:'fixture',E:'fixture',G:'fixture',H:'fixture'}}),'ABEGH',dimensions[5]);
  assertSize(await start({mode:'local3',config:{mapSizeMode:'manual',cols:8}}),'ABC',{cols:8,rows:9});
});

test('non-tank matches keep their config and tick-limit input unchanged',async()=>{
  const config={cols:7,mapSizeMode:'example-owned'};
  const records=[];
  const synthetic={...jumpGame,matchTickLimit(configured){assert.equal(configured,config);return 1;}};
  const seat={act:()=>({value:{jump:false}})};
  const match=await makeMatch({game:synthetic,root:'.',base:'runs',seed:1,mode:'local2',config,human:{A:seat,B:seat},
    recorder:()=>({write:row=>records.push(row),close:()=>{}})});
  await match.run();
  assert.equal(records[0].manifest.config,config);
  assert.equal(records[0].manifest.maxTicks,1);
});
