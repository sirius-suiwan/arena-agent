import {createInterface} from 'node:readline';

const rl=createInterface({input:process.stdin});
for await(const line of rl) {
  const msg=JSON.parse(line);
  if(msg.type==='start') setTimeout(()=>console.log(JSON.stringify({type:'ready',protocol:1})),2200);
  else if(msg.type==='observe'&&msg.tick!==1) console.log(JSON.stringify({
    type:'action',tick:msg.tick,action:{throttle:1,turn:0,fire:false}
  }));
}
