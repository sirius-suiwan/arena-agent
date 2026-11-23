import {createInterface} from 'node:readline';
import {createLaikaPolicy} from './policy.js';

let act=createLaikaPolicy();
for await (const line of createInterface({input:process.stdin})) {
  if (!line.trim()) continue;
  try {
    const msg=JSON.parse(line);
    if(msg.type==='start'){
      act=createLaikaPolicy();
      process.stdout.write(JSON.stringify({type:'ready',protocol:1,name:'Laika（复刻）'})+'\n');
    } else if(msg.type==='observe'){
      const action=act(msg.observation);
      process.stdout.write(JSON.stringify({type:'action',tick:msg.tick,action})+'\n');
    }
  } catch (error) {
    process.stderr.write('Laika: '+error.message+'\n');
  }
}
