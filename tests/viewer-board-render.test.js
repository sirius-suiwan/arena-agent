import assert from 'node:assert/strict';
import {test} from 'node:test';
import {drawTankFrame} from '../games/tank-trouble/renderer/index.js';

test('cream board keeps a stronger perimeter than the slate interior at small and high-DPI sizes', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  const state = Object.freeze({
    width: 960, height: 720, tanks: [], pickups: [], bullets: [],
    walls: [{x1:0,y1:0,x2:960,y2:0}, {x1:60,y1:0,x2:60,y2:120}],
    zone: {x:480,y:360,halfWidth:300,halfHeight:200},
    profile: {render: {wallWidth:5.2, zoneOutsideAlpha:0.22}},
  });
  try {
    for (const [width,height,dpr] of [[310,240,1],[310,240,3],[1040,800,2]]) {
      Object.defineProperty(globalThis,'devicePixelRatio',{value:dpr,configurable:true});
      let path = [];
      const operations = [];
      const ctx = {
        beginPath() { path = []; },
        moveTo(...args) { path.push(args); },
        lineTo(...args) { path.push(args); },
        setTransform(...args) { operations.push(['transform', ...args]); },
        fillRect(...args) { operations.push(['fillRect',this.fillStyle,args]); },
        strokeRect(...args) { operations.push(['strokeRect',this.strokeStyle,args,this.lineWidth]); },
        fill(rule) { operations.push(['fill',this.fillStyle,rule]); },
        stroke() { operations.push(['stroke',this.strokeStyle,path,this.lineWidth]); },
        save(){}, restore(){}, rect(){}, clip(){},
      };
      drawTankFrame({getContext:()=>ctx,getBoundingClientRect:()=>({width,height})},state);
      const [reset, surround, transform, floor, zone, zoneEdge, perimeter, interior, rim] = operations;
      assert.deepEqual(reset,['transform',1,0,0,1,0,0]);
      assert.deepEqual(surround,['fillRect','#fbf6ed',[0,0,width*dpr,height*dpr]]);
      assert.equal(transform[1],transform[4],'world cells remain square');
      assert.deepEqual(floor,['fillRect','#faf3e7',[0,0,960,720]]);
      assert.deepEqual(zone,['fill','rgba(134,71,42,0.22)','evenodd']);
      assert.equal(zoneEdge[1],'rgba(154,77,39,0.78)');
      assert.deepEqual(perimeter.slice(0,3),['strokeRect','#253544',[0,0,960,720]]);
      assert.deepEqual(interior.slice(0,3),['stroke','#49535c',[[60,0],[60,120]]]);
      assert.equal(interior[3],perimeter[3]*0.7);
      assert(interior[3]*transform[1]/dpr >= 1.18,'slate stroke stays visible in CSS pixels');
      assert.equal(rim[1],'#1d2b38');
    }
  } finally {
    if (original) Object.defineProperty(globalThis,'devicePixelRatio',original);
    else delete globalThis.devicePixelRatio;
  }
});
