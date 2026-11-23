import {createInterface} from 'node:readline';
import {makePolicy} from './policy.js';

let policy=makePolicy();
for await (const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
  if (!line.trim()) continue;
  try {
    const msg=JSON.parse(line);
    if (msg.type==='start') {
      policy=makePolicy();
      process.stdout.write(JSON.stringify({type:'ready',protocol:1,name:'GPT-dots'})+'\n');
    } else if (msg.type==='observe') {
      const action=policy(msg.observation);
      process.stdout.write(JSON.stringify({type:'action',tick:msg.tick,action})+'\n');
    }
  } catch(error) {
    process.stderr.write('GPT-dots: '+error.message+'\n');
  }
}
