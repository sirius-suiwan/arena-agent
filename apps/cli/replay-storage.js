import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {isAbsolute,join,normalize} from 'node:path';

function validateDirectory(value) {
  if (typeof value!=='string' || Buffer.byteLength(value)>3000 || /[\p{Cc}\p{Cs}]/u.test(value)) {
    throw new Error('回放目录无效：请输入本机绝对路径。');
  }
  const trimmed=value.trim();
  const dir=trimmed==='~'?homedir():/^~[\\/]/.test(trimmed)?join(homedir(),trimmed.slice(2)):trimmed;
  if (!isAbsolute(dir) || (process.platform==='win32' && !/^[a-z]:[\\/]/i.test(dir))) {
    throw new Error('回放目录必须是本机绝对路径，也可以使用 ~/ 开头。');
  }
  return normalize(dir);
}

async function testWritable(directory) {
  let probe;
  try {
    await mkdir(directory,{recursive:true});
    const file=join(directory,'.arena-write-test-'+randomUUID());
    const handle=await open(file,'wx',0o600);
    probe=file;
    await handle.close();
  } catch {
    throw new Error('无法写入回放目录。请检查路径是否为目录，以及本机用户是否有写入权限。');
  } finally {
    if (probe) await rm(probe,{force:true});
  }
}

export async function openReplayStorage(root,defaultDirectory) {
  const key=createHash('sha256').update(await realpath(root)).digest('hex');
  const configBase=process.env.XDG_CONFIG_HOME && isAbsolute(process.env.XDG_CONFIG_HOME)
    ? process.env.XDG_CONFIG_HOME : join(homedir(),'.config');
  const settingsDir=join(configBase,'arena-agent');
  const configFile=join(settingsDir,`replay-${key}.json`);
  const describe=(custom,warning=null)=>({directory:custom??defaultDirectory,defaultDirectory,custom:custom!==null,warning});
  async function current() {
    try {
      const {directory}=JSON.parse(await readFile(configFile,'utf8'));
      return describe(directory===null?null:validateDirectory(directory));
    } catch (error) {
      return describe(null,error.code==='ENOENT'?null:'无法读取已保存的回放设置；当前使用启动默认目录。');
    }
  }
  let pending=Promise.resolve();
  async function save(value) {
    const directory=value===null?null:validateDirectory(value);
    if (directory!==null) await testWritable(directory);
    const tmp=join(settingsDir,'.replay-setting-'+randomUUID());
    try {
      await mkdir(settingsDir,{recursive:true,mode:0o700});
      await writeFile(tmp,JSON.stringify({directory})+'\n',{flag:'wx',mode:0o600});
      await rename(tmp,configFile);
    } catch {
      throw new Error('无法保存回放设置。请确认本机用户可写入 Arena 配置目录。');
    } finally {
      await rm(tmp,{force:true}).catch(()=>{});
    }
    return describe(directory);
  }
  return {current,update(value) {
    const result=pending.then(()=>save(value));
    pending=result.catch(()=>{});
    return result;
  }};
}
