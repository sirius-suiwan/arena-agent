import {createReadStream} from 'node:fs';
import {mkdir,open,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {compose} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip,createGzip} from 'node:zlib';
import {stateHash} from '../core/match.js';
import {createReplayReconstructor,MAX_REPLAY_LINE,parseReplayLine} from './reconstruct.js';

export const REPLAY_FILENAME = 'match.jsonl.gz';

export async function recorder(directory,onRecord = () => {}) {
  await mkdir(directory,{recursive:true});
  const file = await open(join(directory,REPLAY_FILENAME),'wx');
  const gzip = createGzip({level:6});
  // Attach rejection handling immediately; surface disk and compression failures to the caller.
  const done = pipeline(gzip,file.createWriteStream());
  done.catch(()=>{});
  async function close() {
    if (!gzip.writableEnded) gzip.end();
    await done;
  }
  return {
    async write(record) {
      const {type,manifest,result,state,...row} = record;
      const line = JSON.stringify({type,manifest,result,...row}) + '\n';
      await new Promise((resolve,reject)=>gzip.write(line,error=>error?reject(error):resolve()));
      if (type === 'start') await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
      if (type === 'end') {
        await close();
        await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');
      }
      onRecord(record);
    },
    close
  };
}

// Stream and validate without keeping all replay frames or re-running bots.
export async function* readReplay(path,registry) {
  const replay = createReplayReconstructor(manifest=>
    registry[manifest.game + '@' + manifest.rulesVersion] ?? registry[manifest.game]);
  const text = compose(createReadStream(path),createGunzip()).setEncoding('utf8');
  let pending = '';
  function hydrate(line) {
    const frame = replay.push(parseReplayLine(line));
    if (frame.type !== 'end' && stateHash(frame.state) !== frame.hash) {
      throw new Error(`tick ${frame.tick ?? 0}: ${frame.type === 'start' ? 'start state differs' : 'state differs'}`);
    }
    return frame;
  }
  try {
    for await (const chunk of text) {
      const lines = (pending+chunk).split('\n');
      pending = lines.pop();
      for (const line of lines) yield hydrate(line);
      if (pending.length > MAX_REPLAY_LINE) throw new Error('replay line too large');
    }
    if (pending) yield hydrate(pending);
    replay.finish();
  } finally {
    text.destroy();
  }
}

export async function verifyReplay(path,registry) {
  let ticks = 0, result;
  for await (const frame of readReplay(path,registry)) {
    if (frame.type === 'tick') ticks++;
    if (frame.type === 'end') result = frame.result;
  }
  return {ticks,result};
}
