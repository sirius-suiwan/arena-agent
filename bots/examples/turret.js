import {createInterface} from 'node:readline';
for await (const line of createInterface({input:process.stdin})) {
  const msg = JSON.parse(line);
  if (msg.type === 'start') console.log(JSON.stringify({type:'ready',protocol:1}));
  if (msg.type === 'observe') console.log(JSON.stringify({
    type:'action',tick:msg.tick,action:{throttle:1,turn:msg.tick % 90 < 20 ? 1 : 0,fire:true}
  }));
}
