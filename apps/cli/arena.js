import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {game,gameV1,gameV2,gameV3} from '../../games/tank-trouble/adapter/index.js';
import {recorder,verifyReplay} from '../../replay/index.js';
import {makeMatch} from './match-options.js';
import {serve} from './serve.js';

const root = fileURLToPath(new URL('../../',import.meta.url));
const registry = Object.freeze(Object.fromEntries([game,gameV1,gameV2,gameV3].map(g=>[g.id+'@'+g.version,g])));
const [command,...args] = process.argv.slice(2);

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
      'bot-a':{type:'string'},'bot-b':{type:'string'},'bot-c':{type:'string'},'score-to-win':{type:'string'},port:{type:'string'},
      rounds:{type:'string'},out:{type:'string'},'name-a':{type:'string'},'name-b':{type:'string'},'name-c':{type:'string'},cols:{type:'string'},rows:{type:'string'},'shell-speed':{type:'string'}
    }
  });
  const config=Object.fromEntries([['cols',values.cols],['rows',values.rows],['scoreToWin',values['score-to-win']]]
    .filter(([,value])=>value!==undefined).map(([key,value])=>[key,integer(value)]));
  if (values['shell-speed']!==undefined) {
    const speed=Number(values['shell-speed']);
    if (!Number.isFinite(speed) || speed<3 || speed>9) throw new Error('shell speed must be 3–9 px/tick');
    config.shellSpeed=speed;
  }
  const playerNames=Object.fromEntries(['A','B','C'].flatMap(id=>{
    const value=values['name-'+id.toLowerCase()];
    return value===undefined?[]:[[id,value]];
  }));
  if (command === 'run') {
    const rounds = integer(values.rounds) ?? 1;
    if (rounds < 1 || rounds > 1000) throw new Error('rounds must be 1-1000');
    if (positionals.length) throw new Error('run does not accept positional arguments');
    for (let i = 0; i < rounds; i++) {
      const match = await makeMatch({
        game,root,playerNames,base:resolve(values.out ?? 'runs'),seed:(integer(values.seed) ?? 42)+i,
        maxTicks:integer(values['max-ticks']),timeoutMs:integer(values['timeout-ms']),
        paths:{A:values['bot-a'],B:values['bot-b'],C:values['bot-c']},config,recorder
      });
      console.log(JSON.stringify({directory:match.directory,result:await match.run()}));
    }
  } else if (command === 'verify') {
    if (positionals.length !== 1) throw new Error('verify requires one path to match.jsonl');
    console.log(JSON.stringify(await verifyReplay(positionals[0],registry)));
  } else if (command === 'serve') {
    if (positionals.length) throw new Error('serve does not accept positional arguments');
    await serve({game,root,config,base:resolve(values.out ?? 'runs'),port:integer(values.port) ?? 8765});
  } else if (!command || command === 'help') {
    console.log('node apps/cli/arena.js run | verify <match.jsonl> | serve');
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
