import assert from 'node:assert/strict';
import {test} from 'node:test';
import {replayReport} from '../replay/report.js';

const manifest={game:'tank-trouble',rulesVersion:'8-25',tickRate:25,seed:12,maxTicks:500,matchId:'sample-1',
  players:['A','B','D'],config:{cols:12,teams:{A:'1',B:'1',D:'4'}},
  botVersions:{A:{id:'gpt-dots',file:'/private/absolute-not-for-report.js',sha256:'abcdef'},
    B:{kind:'human'},D:{id:'laika',packageSha256:'012345'}},
  inputInsight:{seats:['D'],timing:'concurrent',capabilities:['pickup-forecast']},
  playerNames:{A:'GPT-dots',B:'Local',D:'Laika'}};
const state={round:1,width:768,height:576,shellLimit:10,config:{cols:12,rows:9},walls:[{huge:'skip'}],
  profile:{crateMinSeconds:10,crateMaxSeconds:16,crateLimit:3},
  phase:'playing',zone:{x:384,y:288,halfWidth:192,halfHeight:150,outsideTicks:{A:0}},
  tanks:[{id:'A',x:11.12345,y:33,angle:0,alive:true,weapon:'laser',weaponAmmo:1}]};
const neutral={throttle:0,turn:0,fire:false};
const a=(accepted=neutral,fallback=null,submitted=accepted)=>({accepted,fallback,submitted});
const tick=(n,events=[],input={},extra={})=>({type:'tick',tick:n,state:{...state,...extra},events,input});
const start={type:'start',manifest,state,readiness:{A:'ready',B:'ready',D:'ready'}};
const end={type:'end',result:{winner:null,winnerTeam:'4',reason:'round-limit',teamScores:{1:1,4:2}}};
async function* rows(...records){yield* records;}

test('report counts authoritative seat telemetry and includes only shareable identifiers',async()=>{
  const report=await replayReport(rows(start,
    tick(0,[{type:'wall-stop',tankId:'A'},{type:'tank-stop',tankIds:['A','B']},
      {type:'shot',tankId:'A',kind:'shell',bulletId:'b1'}],{A:a({...neutral,throttle:1,fire:true}),D:a(neutral,'timeout')}),
    tick(1,[{type:'wall-stop',tankId:'A'},{type:'shot-blocked',tankId:'A',reason:'shell-limit'},
      {type:'pickup',tankId:'D',pickupType:'laser',pickupId:'p1'}],{D:a(neutral,'timeout')}),
    tick(2,[{type:'pickup-blocked',tankId:'D',pickupType:'mine',pickupId:'p2',heldWeapon:'laser'}]),
    tick(3,[{type:'hit',ownerId:'A',tankId:'A',kind:'shell',bulletId:'b1'},
      {type:'destroyed',ownerId:'A',tankId:'A',bulletId:'b1'},
      {type:'destroyed',ownerId:'B',tankId:'D',bulletId:'b2'},
      {type:'destroyed',ownerId:'A',tankId:'B',bulletId:'b3'},
      {type:'zone-eliminated',tankId:'D'},{type:'round-end',round:1,winner:null,winnerTeam:'4'}]),
    end));
  assert.equal(report.ticks,4);
  assert.deepEqual(report.result,end.result);
  assert.equal(report.match.matchId,'sample-1');
  assert.equal(report.match.layout.shellLimit,10);
  assert.equal(report.match.effectiveConfig.rows,9);
  assert.deepEqual(report.match.pickupTiming,{crateMinSeconds:10,crateMaxSeconds:16,crateLimit:3});
  assert.deepEqual(report.match.inputInsight.capabilities,['pickup-forecast']);
  assert.deepEqual(report.match.players[0],{seat:'A',name:'GPT-dots',id:'gpt-dots',sha256:'abcdef',readiness:'ready'});
  assert.equal(report.seats.D.fallbacks,2);
  assert.equal(report.seats.D.longestFallbackStreak,2);
  assert.equal(report.seats.D.fallbackReasons.timeout,2);
  assert.equal(report.seats.D.pickups.laser,1);
  assert.equal(report.seats.D.blockedPickups,1);
  assert.equal(report.seats.D.zoneDeaths,1);
  assert.equal(report.seats.A.longestWallStopStreak,2);
  assert.equal(report.seats.A.tankStops,1);
  assert.equal(report.seats.A.acceptedMoves,1);
  assert.equal(report.seats.A.acceptedFire,1);
  assert.equal(report.seats.A.shots.shell,1);
  assert.equal(report.seats.A.blockedFire['shell-limit'],1);
  assert.equal(report.seats.A.selfEliminations,1);
  assert.equal(report.seats.A.teamEliminations,1);
  assert.equal(report.seats.B.opposingEliminations,1);
  assert.equal(report.eventTotals.destroyed,3);
  assert.equal(report.notableEvents.omitted,0);
  assert.deepEqual(report.notableEvents.items.filter(e=>e.type==='hit'),[
    {tick:3,round:1,type:'hit',tankId:'A',ownerId:'A',bulletId:'b1',kind:'shell'}
  ]);
  assert.ok(!JSON.stringify(report).includes('/private/'));
  assert.ok(!JSON.stringify(report).includes('huge'));
  assert.equal('focus' in report,false);
});

test('large logs keep counts, both timeline edges and a bounded focus with accepted inputs',async()=>{
  const huge='x'.repeat(100_000);
  async function* bulk(){
    yield start;
    for(let i=0;i<200;i++) {
      yield tick(i,[{type:'bounce',bulletId:'b'+i,x:11.1234,y:22},
        {type:'pickup',tankId:'A',pickupType:'laser',pickupId:'p'+i}],
        {A:i===100?a(neutral,'invalid_action',{fire:{nested:huge},turn:huge}):a()},
        {walls:[{data:huge}],bullets:Array.from({length:12},(_,k)=>({id:'r'+k,owner:'D',kind:'shell',
          x:5+k*5,y:22,vx:1,vy:0}))});
    }
    yield end;
  }
  const report=await replayReport(bulk(),{tick:100});
  assert.equal(report.ticks,200);
  assert.equal(report.eventTotals.bounce,200);
  assert.equal(report.notableEvents.total,200);
  assert.equal(report.notableEvents.omitted,188);
  assert.equal(report.notableEvents.items[0].tick,0);
  assert.equal(report.notableEvents.items.at(-1).tick,199);
  assert.equal(report.focus.found,true);
  assert.deepEqual(report.focus.range,[50,150]);
  assert.ok(report.focus.samples.length<=10);
  const sample=report.focus.samples.find(s=>s.tick===100);
  assert.deepEqual(sample.inputs.A.accepted,neutral);
  assert.equal(sample.inputs.A.fallback,'invalid_action');
  assert.equal(sample.inputs.A.submitted.turn.length,140);
  assert.ok(!Object.hasOwn(sample.inputs.A.submitted,'fire'));
  assert.equal(sample.tanksAfter[0].x,11.12);
  assert.equal(sample.nearbyProjectilesAfter.length,8);
  assert.equal(sample.projectilesAfter,12);
  assert.ok(report.focus.events.items.some(e=>e.tick===100&&e.type==='bounce'&&e.x===11.12));
  assert.ok(report.focus.events.omitted>0);
  assert.ok(JSON.stringify(report).length<30_000);
});

test('empty and out-of-range focus remain well defined; malformed ticks reject',async()=>{
  const empty=await replayReport(rows(start,end),{tick:10});
  assert.deepEqual(empty.focus,{tick:10,found:false,range:null,samples:[],events:{total:0,omitted:0,items:[]}});
  assert.equal(empty.ticks,0);
  const outside=await replayReport(rows(start,tick(0),end),{tick:120});
  assert.equal(outside.focus.found,false);
  assert.equal(outside.focus.range,null);
  await assert.rejects(replayReport(rows(start,end),{tick:-1}),/nonnegative integer/);
  await assert.rejects(replayReport(rows(start)),/complete verified replay/);
});
