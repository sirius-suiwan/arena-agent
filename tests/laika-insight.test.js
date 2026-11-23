import assert from 'node:assert/strict';
import test from 'node:test';
import {withLaikaInsight} from '../games/tank-trouble/bots/laika-insight.js';
import {classicProfile} from '../games/tank-trouble/engine/profile.js';

const neutral={throttle:0,turn:0,fire:false};
const moving={...neutral,throttle:1};
const shooting={...neutral,fire:true};
const tank=(id,x,y,angle,props={})=>({id,x,y,angle,alive:true,weapon:null,...props});
function observe(commands,B,overrides={}) {
  return {type:'observe',tick:17,opponentActions:commands,opponentActionsTick:16,observation:{tick:17,roundTick:8,phase:'playing',
    playerId:'A',tanks:[tank('A',64,64,0),B],walls:[],bullets:[],profile:classicProfile(25),...overrides}};
}
function wrap(action=neutral) {
  return withLaikaInsight({act:async()=>({value:action,error:null})});
}

test('continued previous-tick movement can expose a short clear firing line',async()=>{
  const b=tank('B',124,82,-Math.PI/2);
  const seat=wrap();
  assert.deepEqual((await seat.act(observe({B:neutral},b))).value,neutral);
  assert.deepEqual((await seat.act(observe({B:moving},b))).value,shooting);
  assert.deepEqual((await seat.act(observe({B:moving},b,{walls:[{x1:96,y1:0,x2:96,y2:128}]}))).value,neutral);
  assert.deepEqual((await seat.act(observe({B:moving},b,{teams:{A:'1',B:'1'},friendlyFire:true}))).value,neutral);
});

test('the same base shot can be released when continued movement would leave the firing line',async()=>{
  const b=tank('B',132,76,Math.PI/2);
  const seat=wrap(shooting);
  assert.deepEqual((await seat.act(observe({B:neutral},b))).value,shooting);
  assert.deepEqual((await seat.act(observe({B:moving},b))).value,neutral);
  // A held button is not interpreted as a new shot by the overlay.
  const held=tank('A',64,64,0,{fireHeld:true});
  assert.deepEqual((await seat.act(observe({B:moving},b,{tanks:[held,b]}))).value,shooting);
});

test('old fire bits do not authorize a new predicted shot or force a dodge',async()=>{
  const b=tank('B',118,75,Math.PI,{weapon:'laser'});
  const a=tank('A',64,64,Math.PI/2);
  const seat=wrap(moving);
  assert.deepEqual((await seat.act(observe({B:neutral},b,{tanks:[a,b]}))).value,moving);
  assert.deepEqual((await seat.act(observe({B:shooting},b,{tanks:[a,b]}))).value,moving);
});

test('the overlay ignores same-tick input, stale history, and previous-round input',async()=>{
  const b=tank('B',124,82,-Math.PI/2), msg=observe({B:moving},b), seat=wrap();
  for(const opponentActionsTick of [null,15,17,18]) {
    assert.deepEqual((await seat.act({...msg,opponentActionsTick})).value,neutral);
  }
  assert.deepEqual((await seat.act({...msg,tick:0,opponentActionsTick:null})).value,neutral);
  for(const override of [{roundTick:0},{phase:'intermission'},{phase:'finished'}]) {
    assert.deepEqual((await seat.act({...msg,observation:{...msg.observation,...override}})).value,neutral);
  }
});

test('ordinary bot call receives untouched common tick and no read-input metadata',async()=>{
  const b=tank('B',124,82,-Math.PI/2), original=observe({B:moving},b);
  let opened=false,closed=false;
  const originalResponse={error:'timeout',value:null};
  const seat=withLaikaInsight({
    start(message) {assert.equal(message.type,'start');opened=true;},
    act(message,budget) {
      assert.equal(message.tick,17);
      assert.equal(message.observation,original.observation);
      assert.equal(message.opponentActions,undefined);
      assert.equal(message.opponentActionsTick,undefined);
      assert.ok(budget<=50);
      return originalResponse;
    },
    close() {closed=true;}
  });
  seat.start({type:'start'});
  assert.equal(await seat.act(original,50),originalResponse);
  seat.close();
  assert.ok(opened&&closed);
});
