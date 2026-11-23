import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {game,gamesByRate,gameForRate} from '../../games/tank-trouble/adapter/index.js';
import {readReplay,recorder,REPLAY_FILENAME,verifyReplay} from '../../replay/index.js';
import {replayReport} from '../../replay/report.js';
import {makeMatch,playersForMode,seatIds} from './match-options.js';
import {loadBotRegistry} from './bot-registry.js';
import {serve} from './serve.js';
import {randomMatchSeed} from './seed.js';
import {applyTankOptions} from './tank-options.js';

const root = fileURLToPath(new URL('../../',import.meta.url));
const registry = Object.freeze(Object.fromEntries(Object.values(gamesByRate).map(g=>[g.id+'@'+g.version,g])));
const [command,...args] = process.argv.slice(2);
const seatFlags=prefix=>Object.fromEntries(seatIds.map(id=>[prefix+id.toLowerCase(),{type:'string'}]));

function integer(value) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(parsed)) throw new Error(`expected integer: ${value}`);
  return parsed;
}

try {
  const {values,positionals} = parseArgs({
    args,allowPositionals:true,options:{
      seed:{type:'string'}, 'max-ticks':{type:'string'}, 'timeout-ms':{type:'string'},
      ...seatFlags('bot-'),...seatFlags('name-'),'score-to-win':{type:'string'},port:{type:'string'},
      tick:{type:'string'},rounds:{type:'string'},out:{type:'string'},cols:{type:'string'},rows:{type:'string'},'shell-speed':{type:'string'},
      'shrink-after':{type:'string'},'shrink-duration':{type:'string'},'round-limit':{type:'string'},
      'maze-complexity':{type:'string'},'friendly-fire':{type:'string'},'simulation-rate':{type:'string'},teams:{type:'string'}
    }
  });
  if (values.tick!==undefined && command!=='report') throw new Error('--tick is supported by report');
  const overrides=Object.fromEntries([['cols','cols'],['rows','rows'],['shrinkAfterSeconds','shrink-after'],
    ['shrinkDurationSeconds','shrink-duration'],['roundLimit','round-limit'],['simulationRate','simulation-rate']]
    .filter(([,flag])=>values[flag]!==undefined).map(([key,flag])=>[key,integer(values[flag])]));
  if (values['maze-complexity']!==undefined) overrides.mazeComplexity=values['maze-complexity'];
  if (values['friendly-fire']!==undefined) {
    if (!['on','off'].includes(values['friendly-fire'])) throw new Error('--friendly-fire must be on or off');
    overrides.friendlyFire=values['friendly-fire']==='on';
  }
  const {simulationRate=game.tickRate,...config}=applyTankOptions({},overrides);
  const selectedGame=gameForRate(simulationRate);
  if (values['score-to-win']!==undefined) config.scoreToWin=integer(values['score-to-win']);
  if (values.teams!==undefined && command!=='run') throw new Error('--teams is supported by run; use the custom lobby for live teams');
  if (values['shell-speed']!==undefined) {
    const speed=Number(values['shell-speed']);
    if (!Number.isFinite(speed) || speed<3 || speed>9) throw new Error('shell speed must be 3–9 px/tick');
    config.shellSpeed=speed;
  }
  const seatValues=prefix=>Object.fromEntries(seatIds.flatMap(id=>{
    const value=values[prefix+id.toLowerCase()];
    return value===undefined?[]:[[id,value]];
  }));
  const playerNames=seatValues('name-');
  if (command === 'run') {
    const rounds = integer(values.rounds) ?? 1;
    if (rounds < 1 || rounds > 1000) throw new Error('rounds must be 1-1000');
    if (positionals.length) throw new Error('run does not accept positional arguments');
    const baseSeed=integer(values.seed);
    if (baseSeed!==undefined && !Number.isSafeInteger(baseSeed+(rounds-1))) {
      throw new Error('--seed and --rounds exceed the safe integer range');
    }
    const bots=await loadBotRegistry(root,game.id);
    const paths=seatValues('bot-');
    if (values.teams!==undefined) config.teams=selectedGame.validateTeams(JSON.parse(values.teams),playersForMode('bots',paths));
    for (const choice of Object.values(paths)) {
      if (!bots.has(choice) && /^[a-z][a-z0-9-]{0,47}$/.test(choice)) {
        throw new Error('unknown bot id: '+choice);
      }
    }
    for (let i = 0; i < rounds; i++) {
      const match = await makeMatch({
        game:selectedGame,root,playerNames,base:resolve(values.out ?? 'runs'),seed:baseSeed===undefined?randomMatchSeed():baseSeed+i,
        maxTicks:integer(values['max-ticks']),timeoutMs:integer(values['timeout-ms']),
        paths,registry:bots,config,recorder
      });
      console.log(JSON.stringify({directory:match.directory,result:await match.run()}));
    }
  } else if (command === 'verify') {
    if (positionals.length !== 1) throw new Error('verify requires one path to '+REPLAY_FILENAME);
    console.log(JSON.stringify(await verifyReplay(positionals[0],registry)));
  } else if (command === 'report') {
    if (positionals.length !== 1) throw new Error('report requires one path to '+REPLAY_FILENAME);
    const report=await replayReport(readReplay(positionals[0],registry),{tick:integer(values.tick)});
    console.log(JSON.stringify(report,null,2));
  } else if (command === 'serve') {
    if (positionals.length) throw new Error('serve does not accept positional arguments');
    await serve({game:selectedGame,selectGame:gameForRate,root,config,base:resolve(values.out ?? 'runs'),port:integer(values.port) ?? 8765});
  } else if (!command || command === 'help') {
    console.log('node apps/cli/arena.js run [--bot-a <id-or-path> ... --bot-h <id-or-path>] | verify <match.jsonl.gz> | report <match.jsonl.gz> [--tick <n>] | serve\nrun and serve: --simulation-rate <25|30|60> --shrink-after <0–120> --shrink-duration <1–120> --round-limit <0–20> --cols <4–16> --rows <4–12> --maze-complexity <open|classic|dense> --friendly-fire <on|off>\nrun only: --seed <integer> (random if omitted), --teams \'{"A":"1","B":"2"}\'');
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
