import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {basename,extname,join,resolve} from 'node:path';
import {runMatch} from '../../core/match.js';
import {LocalBot} from '../../runners/local-process/index.js';

export const seatIds = Object.freeze([...'ABCDEFGH']);
export const controls = Object.freeze(['arrows','esdf','mouse']);
const recordObject = value => value!==null && typeof value==='object' && !Array.isArray(value);
export const playersForMode = (mode,paths={}) => [
  'A','B',...seatIds.slice(2).filter(id=>(id==='C' && mode==='local3') || paths[id]!==undefined)
];
export const humansForMode = mode => mode==='local3'?['A','B','C']:mode==='local2'?['A','B']:mode==='human'?['A']:[];

export function parseCustomSeats(roster,registry) {
  if (!recordObject(roster)) throw new Error('seats must be an object');
  const entries=Object.entries(roster);
  if (entries.length<2 || entries.length>seatIds.length) throw new Error('choose 2–8 seats');
  const paths={}, humanControls={}, used=new Set();
  for (const [id,entry] of entries) {
    if (!seatIds.includes(id) || !recordObject(entry) || Object.keys(entry).length!==1) {
      throw new Error('seat must be A–H and select exactly one bot or control');
    }
    if (Object.hasOwn(entry,'bot')) {
      if (typeof entry.bot!=='string' || !registry.has(entry.bot)) throw new Error('unknown registered bot for seat '+id);
      paths[id]=entry.bot;
    } else {
      if (!controls.includes(entry.control)) throw new Error('invalid human control for seat '+id);
      if (used.has(entry.control)) throw new Error('human controls must be unique (maximum 3 humans)');
      used.add(entry.control);
      humanControls[id]=entry.control;
    }
  }
  return {ids:seatIds.filter(id=>Object.hasOwn(roster,id)),paths,humanControls};
}

export async function makeMatch({game,root,base,seed,config={},maxTicks=game.matchTickLimit?.(config)??game.defaultMatchTicks??3600,timeoutMs=50,mode='bots',realtime=false,paths={},registry=new Map(),human={},playerNames={},recorder,onRecord,roster}) {
  const custom=mode==='custom'?parseCustomSeats(roster,registry):null;
  if (custom) paths=custom.paths;
  const ids=custom?.ids ?? playersForMode(mode,paths);
  const humanControls=custom?.humanControls;
  const humanIds=humanControls?Object.keys(humanControls):humansForMode(mode);
  const names={...playerNames};
  const plans = await Promise.all(ids.map(async id => {
    if (humanIds.includes(id)) {
      if (!human[id]) throw new Error('no local controller for seat '+id);
      return {id,human:true,version:{kind:'human'}};
    }
    const registered=registry.get(paths[id] ?? 'turret');
    if (registered && names[id]===undefined) names[id]=registered.name;
    const path = registered?.path ?? resolve(paths[id] ?? join(root,'bots','examples','turret.js'));
    const ext = extname(path);
    if (!['.py','.js','.mjs'].includes(ext)) throw new Error('bot extension must be .py, .js or .mjs');
    const sha256 = registered?.sha256 ?? createHash('sha256').update(await readFile(path)).digest('hex');
    return {id,path,command:ext === '.py' ? 'python3' : process.execPath,version:{
      file:basename(path),sha256,...(registered?{id:registered.id,packageSha256:registered.packageSha256}:{})
    }};
  }));
  const matchId = randomUUID();
  const directory = join(base,game.id,matchId);
  const recording = await recorder(directory,onRecord);
  return {directory,matchId,async run({signal}={}) {
    const seats = {};
    try {
      for (const plan of plans) {
        seats[plan.id] = plan.human ? human[plan.id] : new LocalBot(plan.command,[plan.path]);
      }
      return await runMatch({
        game,seats,seed,config,maxTicks,timeoutMs,mode,realtime,matchId,signal,playerNames:names,humanControls,record:message => recording.write(message),
        botVersions:Object.fromEntries(plans.map(p=>[p.id,p.version]))
      });
    } finally {
      for (const seat of Object.values(seats)) seat.close?.();
      await recording.close();
    }
  }};
}
