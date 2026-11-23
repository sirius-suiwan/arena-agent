import {test} from 'node:test';
import assert from 'node:assert/strict';
import {humanControls,humanHelp,keyboardAction,keySeat,pointerSeat} from '../viewer/input.js';
import {tankSeatColor} from '../games/tank-trouble/renderer/index.js';

test('control routing follows assignments rather than fixed seat letters',()=>{
  const manifest={mode:'custom',players:['A','D','G','H'],humanControls:{D:'arrows',G:'esdf',H:'mouse'}};
  assert.equal(keySeat(manifest,'ArrowUp'),'D');
  assert.equal(keySeat(manifest,'KeyD'),'G');
  assert.equal(keySeat(manifest,'KeyQ'),'G');
  assert.equal(keySeat(manifest,'KeyW'),null);
  assert.equal(pointerSeat(manifest),'H');
  assert.equal(keyboardAction(manifest,'A',new Set(['ArrowUp'])),null);
  assert.deepEqual(keyboardAction(manifest,'D',new Set(['ArrowUp','KeyM'])),{throttle:1,turn:0,fire:true});
  assert.deepEqual(keyboardAction(manifest,'G',new Set(['KeyF','KeyQ'])),{throttle:0,turn:1,fire:true});
  assert.match(humanHelp(manifest),/D：.*G：.*H：/);
});

test('quick modes retain their control mappings',()=>{
  assert.deepEqual(humanControls({mode:'local3'}),{A:'arrows',B:'esdf',C:'mouse'});
  assert.equal(keySeat({mode:'human'},'KeyD'),'A');
  assert.equal(keySeat({mode:'local2'},'KeyD'),'B');
  assert.equal(pointerSeat({mode:'local3'}),'C');
  assert.equal(pointerSeat({mode:'custom',humanControls:{}}),null);
});

test('all eight HUD colors are distinct and seats keep their color in a sparse lineup',()=>{
  const colors=[...'ABCDEFGH'].map((id,index)=>tankSeatColor(index,'custom',id));
  assert.equal(new Set(colors).size,8);
  assert.equal(tankSeatColor(0,'custom','H'),colors[7]);
});
