import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {recorder} from '../../replay/index.js';
import {countKills,emptyKillTotals} from '../../viewer/score-data.js';
import {humansForMode,makeMatch,parseCustomSeats,playersForMode,seatIds} from './match-options.js';
import {botCatalog,loadBotRegistry} from './bot-registry.js';
import {applyTankOptions,tankOptions} from './tank-options.js';
import {randomMatchSeed} from './seed.js';
import {openReplayStorage} from './replay-storage.js';

const types = {html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json; charset=utf-8'};
const json = (res,status,data) => { res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data)); };
async function requestBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('expected JSON');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4096) throw new Error('request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function serve({game,selectGame=rate=>rate===game.tickRate?game:null,root,base,port,config={}}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
  const replayModules = new Set([
    'replay/reconstruct.js', 'protocol/game/match-format.js',
    ...['adapter/index.js','engine/classic.js','engine/profile.js','engine/laser-geometry.js','series/index.js','classic-profile.json']
      .map(file=>'games/'+game.id+'/'+file)
  ]);
  const storage=await openReplayStorage(root,base);
  const clients = new Set();
  let active=false, first, latest, terminal, epoch=0, currentMatch;
  let inputs=new Map(), kills={};
  const send = (res,event) => {
    if (!event || res.destroyed) return;
    if (res.writableLength > 256*1024) {res.destroy();return;}
    res.write('data: '+JSON.stringify(event)+'\n\n');
  };
  const publish = event => {
    if (event.type==='start') {
      kills=emptyKillTotals(event.manifest.players);
      first=event={...event,stats:{kills}};
    }
    if (event.type==='tick') {
      kills=countKills(kills,event.events,event.state.teams);
      latest=event={...event,stats:{kills}};
    }
    if (event.type==='end' || event.type==='error') terminal=event;
    for (const res of clients) send(res,event);
  };
  const human = id => ({act:() => {
    const input=inputs.get(id);
    const value={...input.held,fire:input.held.fire || input.fireQueued};
    input.fireQueued=false;
    return {value};
  }});
  const server = createServer(async (req,res) => {
    const host = req.headers.host;
    if (!['127.0.0.1:'+port,'localhost:'+port].includes(host) ||
        (req.headers.origin && req.headers.origin !== 'http://'+host)) return json(res,403,{error:'local origin only'});
    const path = req.url.split('?')[0];
    try {
      if (path==='/api/replay-storage') {
        const site=req.headers['sec-fetch-site'];
        if (site && site!=='same-origin' && site!=='none' ||
            req.method==='POST' && req.headers.origin!=='http://'+host) {
          return json(res,403,{error:'local origin only'});
        }
        res.setHeader('Cache-Control','no-store');
        if (req.method==='GET') return json(res,200,await storage.current());
        if (req.method==='POST') {
          const body=await requestBody(req);
          if (!body || typeof body!=='object' || Object.keys(body).length!==1 || !Object.hasOwn(body,'directory')) {
            return json(res,400,{error:'invalid replay storage request'});
          }
          return json(res,200,await storage.update(body.directory));
        }
        return json(res,405,{error:'method not allowed'});
      }
      if (req.method==='GET' && path==='/api/bots') return json(res,200,{bots:botCatalog(await loadBotRegistry(root,game.id))});
      if (req.method==='GET' && path==='/api/options') return json(res,200,tankOptions({...config,simulationRate:game.tickRate}));
      if (req.method==='GET' && path==='/api/events') {
        if (clients.size >= 16) return json(res,503,{error:'too many viewers'});
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});
        res.write(': connected\n\n');
        clients.add(res);
        res.on('close',()=>clients.delete(res));
        for (const event of [first,latest,terminal]) send(res,event);
        return;
      }
      if (req.method==='POST' && path==='/api/stop') {
        const {matchId}=await requestBody(req);
        const match=currentMatch;
        if (typeof matchId!=='string') return json(res,400,{error:'invalid stop request'});
        if (!match || matchId!==match.id) return json(res,409,{error:'对局已切换'});
        match.controller.abort();
        const completed=await match.done;
        if (completed.error) return json(res,500,{error:completed.error});
        return json(res,200,{matchId,stopped:completed.result.reason==='stopped',result:completed.result});
      }
      if (req.method==='POST' && path==='/api/input') {
        const requestEpoch=epoch;
        const {playerId='A',matchId,...action}=await requestBody(req);
        if (!active || !currentMatch || epoch!==requestEpoch || !inputs.has(playerId) ||
            (matchId!==undefined && matchId!==currentMatch?.id)) return json(res,409,{error:'no human seat in this match'});
        if (currentMatch?.controller.signal.aborted) return json(res,200,{ok:true,ignored:true});
        const value=currentMatch.game.validateAction(action);
        const input=inputs.get(playerId);
        if (value.fire && !input.held.fire) input.fireQueued=true;
        input.held=value;
        return json(res,200,{ok:true});
      }
      if (req.method==='POST' && path==='/api/match') {
        const data = await requestBody(req);
        if (active) return json(res,409,{error:'match already in progress'});
        if (!['bots','human','local2','local3','custom'].includes(data?.mode) || (Object.hasOwn(data,'seed') && !Number.isSafeInteger(data.seed))) return json(res,400,{error:'invalid match options'});
        const {simulationRate=game.tickRate,...matchConfig}=applyTankOptions(config,data);
        const selectedGame=selectGame(simulationRate);
        if (!selectedGame) return json(res,400,{error:'unavailable simulation rate'});
        const mode=data.mode;
        const botSeats=data.mode==='bots'?['A','B','C']:data.mode==='human'?['B']:[];
        if ((mode==='custom' && data.bots!==undefined) || (mode!=='custom' && data.seats!==undefined)) {
          return json(res,400,{error:'use seats for custom mode and bots for preset modes'});
        }
        const useBots=mode==='custom'?Object.values(data.seats??{}).some(seat=>seat && Object.hasOwn(seat,'bot')):botSeats.length>0;
        const registry=useBots?await loadBotRegistry(root,game.id):new Map();
        const custom=mode==='custom'?parseCustomSeats(data.seats,registry):null;
        const paths=data.bots===undefined?{}:data.bots;
        if (!paths || typeof paths!=='object' || Array.isArray(paths) ||
            Object.entries(paths).some(([seat,id])=>!botSeats.includes(seat) || typeof id!=='string' || !registry.has(id))) {
          return json(res,400,{error:'invalid bot selection'});
        }
        if (Object.hasOwn(data,'teams')) {
          matchConfig.teams=selectedGame.validateTeams(data.teams,custom?.ids ?? playersForMode(mode,paths));
        }
        const names=data.playerNames;
        if (names!==undefined && (!names || typeof names!=='object' || Array.isArray(names) ||
            Object.keys(names).some(id=>!(custom?.ids ?? seatIds.slice(0,3)).includes(id) || typeof names[id]!=='string'))) {
          return json(res,400,{error:'invalid player names'});
        }
        if (active) return json(res,409,{error:'match already in progress'});
        active=true;epoch++;first=latest=terminal=currentMatch=undefined;
        const seed=data.seed ?? randomMatchSeed();
        const localSeats=custom?Object.keys(custom.humanControls):humansForMode(mode);
        inputs=new Map(localSeats.map(id=>[id,{held:selectedGame.neutralAction(),fireQueued:false}]));
        try {
          const {directory:replayDirectory}=await storage.current();
          const match=await makeMatch({game:selectedGame,root,base:replayDirectory,config:matchConfig,seed,mode,paths,roster:data.seats,registry,playerNames:names,realtime:true,human:Object.fromEntries([...inputs.keys()].map(id=>[id,human(id)])),recorder,onRecord:publish});
          const controller=new AbortController();
          const session={id:match.matchId,controller,game:selectedGame};
          currentMatch=session;
          session.done=match.run({signal:controller.signal}).then(result=>({result}),error=>{
            publish({type:'error',message:error.message});
            return {error:error.message};
          }).finally(()=>{active=false;});
          json(res,202,{ok:true,matchId:match.matchId});
        } catch(error) {
          active=false;
          throw error;
        }
        return;
      }
      if (req.method==='GET') {
        const file = path==='/' ? 'viewer/lobby.html' : path==='/tank' || path==='/tank/' ? 'viewer/index.html' : path.slice(1);
        const renderer = 'games/'+game.id+'/renderer/';
        if (/^viewer\/[a-zA-Z0-9_.-]+\.(?:html|css|js)$/.test(file) ||
            (file.startsWith(renderer) && /^[a-zA-Z0-9_.-]+\.js$/.test(file.slice(renderer.length))) || replayModules.has(file)) {
          try {
            const bytes=await readFile(join(root,file));
            res.writeHead(200,{'Content-Type':types[file.split('.').at(-1)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
            return res.end(bytes);
          } catch (error) {if (error.code!=='ENOENT') throw error;}
        }
      }
      return json(res,404,{error:'not found'});
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res,400,{error:error.message});
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  console.log('Arena Agent: http://127.0.0.1:'+port);
}
