import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';

export const readRows = async path => gunzipSync(await readFile(path)).toString('utf8').trimEnd().split('\n').map(JSON.parse);
export const writeRows = (path,rows) => writeFile(path,gzipSync(rows.map(row=>JSON.stringify(row)+'\n').join('')));
