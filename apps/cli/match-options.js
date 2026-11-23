import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {basename,extname,join,resolve} from 'node:path';
import {runMatch} from '../../core/match.js';
import {LocalBot} from '../../runners/local-process/index.js';

export async function makeMatch({game,root,base,seed,maxTicks=3600,timeoutMs=50,mode='bots',realtime=false,paths={},human,recorder,onRecord}) {
  const plans = await Promise.all(['A','B'].map(async id => {
    if (mode === 'human' && id === 'A') return {id,human:true,version:{kind:'human'}};
    const path = resolve(paths[id] ?? join(root,'bots','examples','turret.js'));
    const ext = extname(path);
    if (!['.py','.js','.mjs'].includes(ext)) throw new Error('bot extension must be .py, .js or .mjs');
    const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
    return {id,path,command:ext === '.py' ? 'python3' : process.execPath,version:{file:basename(path),sha256}};
  }));
  const directory = join(base,game.id,randomUUID());
  const recording = await recorder(directory,onRecord);
  return {directory,async run() {
    const seats = {};
    try {
      for (const plan of plans) {
        seats[plan.id] = plan.human ? human : new LocalBot(plan.command,[plan.path]);
      }
      return await runMatch({
        game,seats,seed,maxTicks,timeoutMs,mode,realtime,record:message => recording.write(message),
        botVersions:Object.fromEntries(plans.map(p=>[p.id,p.version]))
      });
    } finally {
      for (const seat of Object.values(seats)) seat.close?.();
      await recording.close();
    }
  }};
}
