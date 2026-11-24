import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {gamesByRate} from '../games/tank-trouble/adapter/index.js';
import {verifyReplay} from '../replay/index.js';

const root=fileURLToPath(new URL('../',import.meta.url));

async function freePort() {
  const server=createServer().listen(0,'127.0.0.1');
  await once(server,'listening');
  const {port}=server.address();
  await new Promise(resolve=>server.close(resolve));
  return port;
}

async function startServer(t,env,base) {
  const port=await freePort();
  const url='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,['apps/cli/arena.js','serve','--port',String(port),'--out',base],{
    cwd:root,env,stdio:['ignore','ignore','pipe']
  });
  let stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const exited=once(child,'exit');
  let stopped=false;
  async function stop() {
    if (stopped) return;
    stopped=true;
    if (child.exitCode===null && child.signalCode===null) child.kill();
    await exited;
  }
  t.after(stop);
  const api=async(path,body,headers={})=>{
    const opts=body===undefined?{headers}:{method:'POST',headers:{
      Origin:url,'Content-Type':'application/json',...headers
    },body:JSON.stringify(body)};
    return fetch(url+path,{...opts,signal:AbortSignal.timeout(5000)});
  };
  for(let attempts=0;attempts<100;attempts++) {
    const result=await api('/api/replay-storage').catch(()=>null);
    if (result?.ok) {await result.json();return {api,url,stop};}
    if (child.exitCode!==null) break;
    await delay(20);
  }
  assert.fail('server failed to listen: '+stderr);
}

test('web replay directory persists across restarts, applies to future matches only, and reveals no source files', async t=>{
  const temp=await mkdtemp(join(tmpdir(),'arena-replay-dir-'));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const env={...process.env,XDG_CONFIG_HOME:join(temp,'config')};
  const defaultDir=join(temp,'启动默认');
  const nextDir=join(temp,'新的 录像');
  const blocked=join(temp,'existing-file');
  const arena=await startServer(t,env,defaultDir);
  const storage='/api/replay-storage';
  const original={directory:defaultDir,defaultDirectory:defaultDir,custom:false,warning:null};
  assert.deepEqual(await (await arena.api(storage)).json(),original);
  assert.equal((await arena.api(storage,{directory:nextDir},{Origin:'https://other.invalid'})).status,403);
  assert.equal((await arena.api(storage,{directory:nextDir},{'Sec-Fetch-Site':'same-site'})).status,403);
  assert.equal((await arena.api(storage,undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await fetch(arena.url+storage,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({directory:nextDir})})).status,403);
  assert.equal((await arena.api(storage,{directory:'relative-path'})).status,400);
  await writeFile(blocked,'not a directory');
  assert.equal((await arena.api(storage,{directory:blocked})).status,400);
  assert.deepEqual(await (await arena.api(storage)).json(),original);
  const start=async(server)=>{
    const response=await server.api('/api/match',{mode:'human',seed:11});
    assert.equal(response.status,202);
    return (await response.json()).matchId;
  };
  const stop=async(server,matchId)=>{
    const response=await server.api('/api/stop',{matchId});
    assert.equal(response.status,200);
    assert.equal((await response.json()).stopped,true);
  };
  const first=await start(arena);
  const custom=await arena.api(storage,{directory:nextDir});
  assert.equal(custom.status,200);
  assert.deepEqual(await custom.json(),{...original,directory:nextDir,custom:true});
  assert.deepEqual(await readdir(nextDir),[]);
  await stop(arena,first);
  assert.deepEqual((await readdir(join(defaultDir,'tank-trouble',first))).sort(),['manifest.json','match.jsonl.gz','result.json']);
  assert.deepEqual(await readdir(nextDir),[]);
  await arena.stop();

  const restarted=await startServer(t,env,defaultDir);
  assert.deepEqual(await (await restarted.api(storage)).json(),{...original,directory:nextDir,custom:true});
  const second=await start(restarted);
  // Requesting a stop immediately could validly create a zero-tick replay.
  // Wait for the real browser SSE endpoint to publish at least one frame.
  const stream=await restarted.api('/api/events');
  assert.equal(stream.status,200);
  const reader=stream.body.getReader();
  let buffered='';
  try {
    while (!buffered.includes('"type":"tick"')) {
      const {value,done}=await reader.read();
      assert.ok(!done,'match ended before publishing a tick');
      buffered+=Buffer.from(value).toString('utf8');
    }
  } finally {
    await reader.cancel();
  }
  await stop(restarted,second);
  const matchDir=join(nextDir,'tank-trouble',second);
  assert.deepEqual((await readdir(matchDir)).sort(),['manifest.json','match.jsonl.gz','result.json']);
  assert.deepEqual(await readdir(join(defaultDir,'tank-trouble')),[first]);
  const manifest=JSON.parse(await readFile(join(matchDir,'manifest.json'),'utf8'));
  assert.deepEqual(Object.keys(manifest.botVersions.B).sort(),['file','id','packageSha256','policy','sha256']);
  assert.equal(manifest.botVersions.B.file,'bot.js');
  const log=gunzipSync(await readFile(join(matchDir,'match.jsonl.gz'))).toString('utf8');
  assert.ok(!log.includes(root) && !log.includes(temp) && !log.includes('createLaikaPolicy'));
  assert.ok(!JSON.stringify(manifest).includes(temp));
  const registry=Object.fromEntries(Object.values(gamesByRate).map(game=>[game.id+'@'+game.version,game]));
  const verified=await verifyReplay(join(matchDir,'match.jsonl.gz'),registry);
  assert.ok(verified.ticks>0);
  assert.equal(verified.result.reason,'stopped');
  assert.equal((await restarted.api('/bots/laika/bot.js')).status,404);
  assert.equal((await restarted.api('/tank-trouble/'+second+'/match.jsonl.gz')).status,404);

  assert.deepEqual(await (await restarted.api(storage,{directory:null})).json(),original);
  await restarted.stop();
  const reset=await startServer(t,env,defaultDir);
  assert.deepEqual(await (await reset.api(storage)).json(),original);
  const third=await start(reset);
  await stop(reset,third);
  assert.deepEqual((await readdir(join(defaultDir,'tank-trouble'))).sort(),[first,third].sort());
  assert.deepEqual(await readdir(join(nextDir,'tank-trouble')),[second]);
  await reset.stop();
});
