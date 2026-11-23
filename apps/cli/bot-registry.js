import {createHash} from 'node:crypto';
import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import {extname,join,relative,sep} from 'node:path';

const keyPattern=/^[a-z][a-z0-9-]{0,47}$/;
const inside=(root,path)=>{
  const rel=relative(root,path);
  return rel!=='' && rel!=='..' && !rel.startsWith('..'+sep);
};
const validFile=value=>typeof value==='string' && value.length<=240 &&
  value.split('/').every(part=>/^[a-zA-Z0-9_.-]+$/.test(part) && part!=='.' && part!=='..');

export async function loadBotRegistry(root,gameId) {
  const folder=await realpath(join(root,'bots'));
  const bots=new Map();
  const seen=new Set();
  const dirs=(await readdir(folder,{withFileTypes:true})).filter(item=>item.isDirectory() && !item.name.startsWith('.'));
  for (const item of dirs.sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
    const dir=await realpath(join(folder,item.name));
    if (!inside(folder,dir)) throw new Error('bot package resolves outside bots: '+item.name);
    const candidates=(await readdir(dir,{withFileTypes:true})).filter(file=>file.name==='bot.json'||file.name.endsWith('.bot.json'));
    for (const {name} of candidates.sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      try {
        const safePath=async file=>{
          if (!validFile(file)) throw new Error('file must be a package-relative path: '+String(file));
          const path=await realpath(join(dir,file)).catch(error=>{
            if (error.code==='ENOENT') throw new Error('missing package file: '+file);
            throw error;
          });
          if (!inside(dir,path) || !(await stat(path)).isFile()) throw new Error('file resolves outside package or is not a regular file: '+file);
          return path;
        };
        const manifest=await readFile(await safePath(name));
        const data=JSON.parse(manifest);
        if (data?.schema!==1 || data.protocol!==1 || typeof data.id!=='string' || !keyPattern.test(data.id) ||
            typeof data.game!=='string' || !keyPattern.test(data.game) ||
            typeof data.name!=='string' || !data.name.trim() || [...data.name].length>24 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(data.name) ||
            !validFile(data.entry) || !['.js','.mjs','.py'].includes(extname(data.entry))) {
          throw new Error('expected schema:1, protocol:1, a valid id, game, name and .js/.mjs/.py entry');
        }
        const files=data.files===undefined?[]:data.files;
        if (!Array.isArray(files)||files.length>64||files.some(file=>!validFile(file)||file===data.entry)||
            new Set(files).size!==files.length) throw new Error('files must be a list of unique package-relative dependencies');
        const key=data.game+':'+data.id;
        if (seen.has(key)) throw new Error('duplicate bot id for '+data.game+': '+data.id);
        seen.add(key);
        if (data.game!==gameId) continue;

        const path=await safePath(data.entry);
        const parts=[];
        for (const file of [data.entry,...files.slice().sort()]) {
          const bytes=await readFile(file===data.entry?path:await safePath(file));
          parts.push([file,createHash('sha256').update(bytes).digest('hex')]);
        }
        const packageSha256=createHash('sha256').update(JSON.stringify([
          createHash('sha256').update(manifest).digest('hex'),parts
        ])).digest('hex');
        bots.set(data.id,Object.freeze({id:data.id,name:data.name.trim(),path,sha256:parts[0][1],packageSha256}));
      } catch (error) {
        throw new Error('bots/'+item.name+'/'+name+': '+error.message,{cause:error});
      }
    }
  }
  return bots;
}

export const botCatalog=registry=>[...registry.values()].map(({id,name})=>({id,name})).sort((a,b)=>a.id.localeCompare(b.id,'en'));
