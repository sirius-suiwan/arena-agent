import {createReadStream} from 'node:fs';
import {mkdir,open,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {canonical,stateHash} from '../core/match.js';

export async function recorder(directory,onRecord = () => {}) {
  await mkdir(directory,{recursive:true});
  const file = await open(join(directory,'match.jsonl'),'wx');
  return {
    async write(record) {
      const {type,manifest,result} = record;
      await file.writeFile(JSON.stringify(record) + '\n');
      if (type === 'start') await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
      if (type === 'end') await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');
      onRecord(record);
    },
    close: () => file.close()
  };
}

export async function verifyReplay(path,registry) {
  const lines = createInterface({input:createReadStream(path),crlfDelay:Infinity});
  let state, game, manifest, expected, tick = 0, ended = false;
  const check = (condition,message) => { if (!condition) throw new Error(`tick ${tick}: ${message}`); };
  const same = (a,b) => canonical(a) === canonical(b);
  try {
    for await (const line of lines) {
      check(!ended,'unexpected data after end');
      const record = JSON.parse(line);
      if (!manifest) {
        check(record.type === 'start' && record.manifest?.format === 1,'missing or unsupported start');
        manifest = record.manifest;
        game = registry[manifest.game + '@' + manifest.rulesVersion] ?? registry[manifest.game];
        check(game?.version === manifest.rulesVersion && game.tickRate === manifest.tickRate,'unknown rules version');
        state = game.init(manifest);
        check(stateHash(state) === record.hash && stateHash(record.state) === record.hash,'start state differs');
      } else if (record.type === 'tick') {
        check(!expected && tick < manifest.maxTicks && record.tick === tick,'out-of-order tick');
        const actions = Object.fromEntries(manifest.players.map(id => [id,game.validateAction(record.input[id].accepted)]));
        const next = game.step(state,actions);
        state = next.state;
        check(stateHash(state) === record.hash && stateHash(record.state) === record.hash,'state differs');
        check(same(next.events,record.events),'events differ');
        expected = next.result;
        tick++;
      } else {
        check(record.type === 'end','unexpected record type');
        expected ??= tick === manifest.maxTicks ? {winner:null,reason:'tick_limit'} : undefined;
        check(expected && same(expected,record.result),'result differs');
        ended = true;
      }
    }
    check(ended,'missing end');
    return {ticks:tick,result:expected};
  } finally {
    lines.close();
  }
}
