// Small, shareable summaries of an authoritative replay. Records are supplied by
// the verified streaming reader; this module never opens files or runs bots.
const EVENT_LIMITS = Object.freeze({rounds:40, eliminations:16, hits:12, crates:12, special:8});
const REPORT_EVENT = Object.freeze({
  'round-start':'rounds','round-end':'rounds','last-tank-pending':'rounds','last-team-pending':'rounds',
  destroyed:'eliminations','zone-eliminated':'eliminations',
  hit:'hits',
  'pickup-spawn':'crates',pickup:'crates','pickup-blocked':'crates',
  'mine-trigger':'special','mine-burst':'special','frag-burst':'special','weapon-fired':'special'
});
const FOCUS_TYPES=new Set([...Object.keys(REPORT_EVENT),'tank-stop','wall-stop','shot-blocked','shot','bounce','shell-expired']);
const EVENT_FIELDS=['tankId','tankIds','ownerId','bulletId','kind','reason','weapon','pickupType','pickupId','heldWeapon',
  'winner','winnerTeam','teamId','mineId','settleUntil','detonateAt','activation','releaseRequired','weaponAmmo','x','y'];
const text = value => typeof value==='string'?value.slice(0,140):value;
const tidy = value => typeof value==='number'&&Number.isFinite(value)?Math.round(value*100)/100:text(value);
const pick = (object,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(object??{},k)).map(k=>[k,object[k]]));
function counter(){ return Object.create(null); }
function bump(map,key) { if(typeof key==='string') map[text(key)]=(map[text(key)]??0)+1; }
function tally(limit) {
  const early=[],late=[];
  const half=Math.floor(limit/2);
  let total=0;
  return {
    add(value) {
      total++;
      if(early.length<half) early.push(value);
      else {
        if(late.length===limit-half) late.shift();
        late.push(value);
      }
    },
    output(){ return {total,omitted:total-early.length-late.length,items:[...early,...late]}; }
  };
}

function eventRecord(record,event,order) {
  const round=event.round??record.state?.round;
  const detail={tick:record.tick,...(Number.isInteger(round)?{round}:{}),type:event.type};
  for(const k of EVENT_FIELDS) if(Object.hasOwn(event,k)) {
    const v=event[k];
    detail[k]=Array.isArray(v)?v.slice(0,8).map(tidy):tidy(v);
  }
  return {order,detail};
}

function seatCounters() {
  return {fallbacks:0,fallbackReasons:counter(),wallStops:0,tankStops:0,longestWallStopStreak:0,
    longestFallbackStreak:0,acceptedMoves:0,acceptedFire:0,shots:counter(),blockedFire:counter(),hitsLanded:0,hitsTaken:0,
    opposingEliminations:0,teamEliminations:0,selfEliminations:0,zoneDeaths:0,pickups:counter(),blockedPickups:0,
    _wallStreak:0,_fallbackStreak:0};
}
function readableSeat({ _wallStreak,_fallbackStreak,...rest }) { return rest; }

function shortConfig(config) {
  // Only primitive options and the small team map have meaning to a report.
  return Object.fromEntries(Object.entries(config??{}).slice(0,40).flatMap(([key,value])=>{
    if(key==='teams'&&value&&typeof value==='object'){
      return [[key,Object.fromEntries(Object.entries(value).slice(0,8).map(([id,team])=>[text(id),text(team)]))]];
    }
    return value===null||['number','string','boolean'].includes(typeof value)?[[text(key),text(value)]]:[];
  }));
}
function matchDetails(manifest,readiness,state) {
  const info=pick(manifest,['matchId','game','rulesVersion','tickRate','seed','mode','realtime','timeoutMs','maxTicks']);
  const players=manifest.players.map(id=>({
    seat:id,name:text(manifest.playerNames?.[id]??id),
    ...pick(manifest.botVersions?.[id],['id','kind','sha256','packageSha256','policy']),
    readiness:text(readiness?.[id]??null)
  }));
  const layout=pick(state,['width','height','shellLimit','targetScore','roundLimit']);
  const pickupTiming=pick(state?.profile,['crateMinSeconds','crateMaxSeconds','crateLimit']);
  return {...info,config:shortConfig(manifest.config),
    ...(Array.isArray(manifest.inputInsight?.seats)?{inputInsight:{
      seats:manifest.inputInsight.seats.filter(id=>manifest.players.includes(id)).slice(0,8),
      ...pick(manifest.inputInsight,['contract','timing','policy'])
    }}:{}),
    ...(state?.config?{effectiveConfig:shortConfig(state.config)}:{}),
    ...(Object.keys(layout).length?{layout}:{}),
    ...(Object.keys(pickupTiming).length?{pickupTiming}:{}),players};
}

function focusSample(record) {
  const s=record.state;
  const tanks=(s?.tanks??[]).slice(0,8).map(t=>({
    id:t.id,x:tidy(t.x),y:tidy(t.y),angle:tidy(t.angle),alive:t.alive,
    ...(t.weapon?{weapon:t.weapon,weaponAmmo:t.weaponAmmo}:{}),
    ...(t.invulnerable?{invulnerable:true}:{})
  }));
  const projectiles=s?.bullets??[];
  // Keep nearest threats and prioritize distance over registration order.
  const threats=projectiles.map(b=>({b,d:tanks.reduce((min,t)=>t.alive?
    Math.min(min,(t.x-b.x)**2+(t.y-b.y)**2):min,Infinity)})).sort((a,b)=>a.d-b.d).slice(0,8)
    .map(({b})=>({id:b.id,owner:b.owner,kind:b.kind,x:tidy(b.x),y:tidy(b.y),vx:tidy(b.vx),vy:tidy(b.vy)}));
  const inputs=Object.fromEntries(Object.entries(record.input??{}).slice(0,8).map(([id,row])=>{
    const compact=a=>Object.fromEntries(Object.entries(pick(a,['throttle','turn','fire']))
      .filter(([,v])=>v===null||['number','boolean','string'].includes(typeof v)).map(([k,v])=>[k,text(v)]));
    return [id,{accepted:compact(row.accepted),...(row.fallback?{fallback:text(row.fallback),submitted:compact(row.submitted)}:{})}];
  }));
  return {tick:record.tick,round:s?.round,phase:s?.phase,tanksAfter:tanks,inputs,projectilesAfter:projectiles.length,
    nearbyProjectilesAfter:threats,
    ...(s?.zone?{zoneAfter:{x:tidy(s.zone.x),y:tidy(s.zone.y),
      halfWidth:tidy(s.zone.halfWidth),halfHeight:tidy(s.zone.halfHeight)}}:{})};
}

/**
 * Consume hydrated start/tick/end records from readReplay and return one bounded
 * JSON-compatible report. A focus tick uses the host's zero-based input index:
 * its accepted actions produce the positions marked After, not the preceding state.
 */
export async function replayReport(records,{tick}={}) {
  if(tick!==undefined&&(!Number.isSafeInteger(tick)||tick<0)) throw new RangeError('report tick must be a nonnegative integer');
  const notable=Object.fromEntries(Object.entries(EVENT_LIMITS).map(([kind,limit])=>[kind,tally(limit)]));
  const totals=counter();
  let match,manifest,result,seats,limit=0,last=null,observed=0,order=0;
  const samples=[],focusEvents=tally(24),exactEvents=tally(16);
  let focusFound=false;
  for await(const record of records) {
    if(record.type==='start'){
      manifest=record.manifest;
      match=matchDetails(manifest,record.readiness,record.state);
      seats=new Map(manifest.players.map(id=>[id,seatCounters()]));
      limit=2*manifest.tickRate;
    } else if(record.type==='end') {
      result=record.result;
    } else if(record.type==='tick') {
      observed++;last=record.tick;
      const inFocus=tick!==undefined&&Math.abs(record.tick-tick)<=limit;
      if(inFocus&&record.tick===tick) focusFound=true;
      if(inFocus) {
        const interval=Math.max(1,Math.round(manifest.tickRate/2));
        if (record.tick===tick || ((record.tick-tick)%interval===0 && samples.length<10)) samples.push(focusSample(record));
      }
      const wallStops=new Set();
      for(const [id,c] of seats) {
        const input=record.input?.[id];
        if(input?.fallback) {
          c.fallbacks++;bump(c.fallbackReasons,input.fallback);
          c._fallbackStreak++;
          c.longestFallbackStreak=Math.max(c.longestFallbackStreak,c._fallbackStreak);
        } else c._fallbackStreak=0;
        if(input?.accepted?.throttle) c.acceptedMoves++;
        if(input?.accepted?.fire===true) c.acceptedFire++;
      }
      for(const event of record.events??[]) {
        bump(totals,event.type);
        const actor=seats.get(event.ownerId),seat=seats.get(event.tankId);
        const category=Object.hasOwn(REPORT_EVENT,event.type)?REPORT_EVENT[event.type]:undefined;
        switch(event.type) {
          case 'wall-stop': if(seat){seat.wallStops++;wallStops.add(event.tankId);} break;
          case 'tank-stop': for(const id of event.tankIds??[]){const c=seats.get(id);if(c)c.tankStops++;} break;
          case 'shot': if(seat) bump(seat.shots,event.kind??'unknown'); break;
          case 'shot-blocked':if(seat) bump(seat.blockedFire,event.reason??'unknown');break;
          case 'hit': if(actor) actor.hitsLanded++;if(seat) seat.hitsTaken++;break;
          case 'destroyed':
            if(actor) {
              const team=manifest.config?.teams?.[event.ownerId];
              if(event.ownerId===event.tankId) actor.selfEliminations++;
              else if(team!==undefined&&team===manifest.config?.teams?.[event.tankId]) actor.teamEliminations++;
              else actor.opposingEliminations++;
            }
            break;
          case 'zone-eliminated':if(seat) seat.zoneDeaths++;break;
          case 'pickup':if(seat) bump(seat.pickups,event.pickupType);break;
          case 'pickup-blocked':if(seat) seat.blockedPickups++;break;
        }
        if(category||(inFocus&&FOCUS_TYPES.has(event.type))) {
          const detail=eventRecord(record,event,order++);
          if(category) notable[category].add(detail);
          if(inFocus&&FOCUS_TYPES.has(event.type)) {
            if(record.tick===tick) exactEvents.add(detail);
            else focusEvents.add(detail);
          }
        }
      }
      for(const [id,c] of seats) {
        c._wallStreak=wallStops.has(id)?c._wallStreak+1:0;
        c.longestWallStopStreak=Math.max(c.longestWallStopStreak,c._wallStreak);
      }
    }
  }
  if(!match||result===undefined) throw new Error('report requires a complete verified replay');
  const bounded=Object.values(notable).map(bucket=>bucket.output());
  const ordered=items=>items.sort((a,b)=>a.order-b.order).map(x=>x.detail);
  const focus=()=>{
    const around=focusEvents.output(),exact=exactEvents.output();
    const first=Math.max(0,tick-limit),end=last===null?-1:Math.min(last,tick+limit);
    return {
      tick,found:focusFound,range:first<=end?[first,end]:null,
      samples,
      events:{total:around.total+exact.total,omitted:around.omitted+exact.omitted,
        items:ordered([...around.items,...exact.items])}
    };
  };
  return {match,ticks:observed,result,seats:Object.fromEntries([...seats].map(([id,c])=>[id,readableSeat(c)])),eventTotals:totals,
    notableEvents:{total:bounded.reduce((sum,b)=>sum+b.total,0),omitted:bounded.reduce((sum,b)=>sum+b.omitted,0),
      items:ordered(bounded.flatMap(b=>b.items))},...(tick===undefined?{}:{focus:focus()})};
}
