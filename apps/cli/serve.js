import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {recorder} from '../../replay/index.js';
import {humansForMode,makeMatch} from './match-options.js';

const types = {html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
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

export async function serve({game,root,base,port}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
  const clients = new Set();
  let active=false, mode, first, latest, terminal, epoch=0;
  let inputs=new Map();
  const send = (res,event) => {
    if (!event || res.destroyed) return;
    if (res.writableLength > 256*1024) {res.destroy();return;}
    res.write('data: '+JSON.stringify(event)+'\n\n');
  };
  const publish = event => {
    if (event.type==='start') first=event;
    if (event.type==='tick') latest=event;
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
      if (req.method==='GET' && path==='/api/events') {
        if (clients.size >= 16) return json(res,503,{error:'too many viewers'});
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});
        res.write(': connected\n\n');
        clients.add(res);
        res.on('close',()=>clients.delete(res));
        for (const event of [first,latest,terminal]) send(res,event);
        return;
      }
      if (req.method==='POST' && path==='/api/input') {
        const requestEpoch=epoch;
        const {playerId='A',...action}=await requestBody(req);
        if (!active || epoch!==requestEpoch || !inputs.has(playerId)) return json(res,409,{error:'no human seat'});
        const value=game.validateAction(action);
        const input=inputs.get(playerId);
        if (value.fire && !input.held.fire) input.fireQueued=true;
        input.held=value;
        return json(res,200,{ok:true});
      }
      if (req.method==='POST' && path==='/api/match') {
        const data = await requestBody(req);
        if (active) return json(res,409,{error:'match already in progress'});
        if (!['bots','human','local2','local3'].includes(data?.mode) || !Number.isSafeInteger(data.seed)) return json(res,400,{error:'invalid match options'});
        active=true;mode=data.mode;epoch++;first=latest=terminal=undefined;
        inputs=new Map(humansForMode(mode).map(id=>[id,{held:game.neutralAction(),fireQueued:false}]));
        try {
          const match=await makeMatch({game,root,base,seed:data.seed,mode,realtime:true,human:Object.fromEntries([...inputs.keys()].map(id=>[id,human(id)])),recorder,onRecord:publish});
          json(res,202,{ok:true,matchId:match.directory.split(/[\\/]/).at(-1)});
          void match.run().catch(error=>publish({type:'error',message:error.message})).finally(()=>{active=false;});
        } catch(error) {
          active=false;
          throw error;
        }
        return;
      }
      if (req.method==='GET') {
        const file = path==='/' ? 'viewer/index.html' : path.slice(1);
        const renderer = 'games/'+game.id+'/renderer/';
        if (/^viewer\/[a-zA-Z0-9_.-]+\.(?:html|css|js)$/.test(file) ||
            (file.startsWith(renderer) && /^[a-zA-Z0-9_.-]+\.js$/.test(file.slice(renderer.length)))) {
          try {
            const bytes=await readFile(join(root,file));
            res.writeHead(200,{'Content-Type':types[file.split('.').at(-1)],'X-Content-Type-Options':'nosniff'});
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
