import {mkdir,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHistogram,monitorEventLoopDelay,performance} from 'node:perf_hooks';

const phases=['tickIntervalMs','hintMs','observationMs','dispatchBudgetMs','preDispatchLatenessMs','botWaitMs',
  'validateActionsMs','stepMs','hashMs','scheduleWaitMs','recordAndPublishMs','publishDeadlineOverrunMs',
  'recordCompleteOverrunMs'];
const knownFallbacks=new Set(['timeout','invalid_action','process_unavailable','process_exit','backpressure',
  'observation_too_large','invalid_json','line_too_long','protocol_mismatch','closed']);
const startupStatuses=new Set(['ready','startup_aborted','startup_timeout','startup_error',...knownFallbacks]);
const rounded=n=>Number.isFinite(n)?Math.round(n*1000)/1000:null;
const ms=n=>rounded(n/1000);
const newHistogram=()=>createHistogram({lowest:1,highest:3_600_000_000,figures:2});
const add=(hist,n)=>hist.record(1+Math.min(3_599_999_999,Math.max(0,Math.round(n*1000))));
const summarize=hist=>({
  count:hist.count,min:hist.count?ms(hist.min-1):null,p05:hist.count?ms(hist.percentile(5)-1):null,
  p50:hist.count?ms(hist.percentile(50)-1):null,p95:hist.count?ms(hist.percentile(95)-1):null,
  p99:hist.count?ms(hist.percentile(99)-1):null,max:hist.count?ms(hist.max-1):null
});
const summarizeLoop=hist=>({
  count:hist.count,p50:hist.count?rounded(hist.percentile(50)/1e6):null,
  p95:hist.count?rounded(hist.percentile(95)/1e6):null,p99:hist.count?rounded(hist.percentile(99)/1e6):null,
  max:hist.count?rounded(hist.max/1e6):null
});
const usage=(cpu,elu,at)=>{
  const {user,system}=process.cpuUsage(cpu);
  const wallMs=performance.now()-at;
  return {wallMs:rounded(wallMs),cpuUserMs:ms(user),cpuSystemMs:ms(system),
    cpuPercent:wallMs>0?rounded((user+system)/10/wallMs):null,
    eventLoopUtilization:rounded(performance.eventLoopUtilization(elu).utilization)};
};

export function createMatchPerformance({matchId,game,rulesVersion,tickRate,mode,seatIds}) {
  const at=performance.now(), cpu=process.cpuUsage(), elu=performance.eventLoopUtilization();
  const createdAt=new Date().toISOString();
  const histograms=Object.fromEntries(phases.map(phase=>[phase,newHistogram()]));
  const counters={ticks:0,budgetFloorTicks:0,deadlineResyncs:0,timeoutTicks:0,multiSeatTimeoutTicks:0,maxTimeoutsPerTick:0};
  const loop=monitorEventLoopDelay({resolution:10});
  loop.enable();
  const startup={initMs:null,processSetupMs:null,gateMs:null,countdownMs:null,recordStartMs:null};
  const seats=Object.fromEntries(seatIds.map(id=>[id,{
    kind:'unknown',startup:null,responses:0,accepted:0,fallbacks:0,fallbackReasons:{},
    overBudgetResponses:0,overBudgetAccepted:0,longestConsecutiveTimeouts:0,consecutiveTimeouts:0,
    responseMs:newHistogram(),dispatchOffsetMs:newHistogram()
  }]));
  let combat, combatUsage=null, combatLoop=null, summary;

  return {
    prepareSeat(id,kind,botId) {
      seats[id].kind=kind;
      if(kind==='bot') seats[id].spawnAt=performance.now();
      if(typeof botId==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(botId)) seats[id].botId=botId;
    },
    ready(id,status,handshakeMs) {
      const seat=seats[id];
      seat.startup={status:startupStatuses.has(status)?status:'other',
        handshakeMs:rounded(handshakeMs??seat.startup?.handshakeMs),
        sinceSpawnMs:seat.startup?.sinceSpawnMs??(seat.spawnAt===undefined?null:rounded(performance.now()-seat.spawnAt))};
    },
    startup(phase,elapsed) {startup[phase]=rounded(elapsed);},
    beginCombat() {
      loop.reset();
      combat={at:performance.now(),cpu:process.cpuUsage(),elu:performance.eventLoopUtilization()};
    },
    endCombat() {
      if(combat) {
        combatUsage=usage(combat.cpu,combat.elu,combat.at);
        combatLoop=summarizeLoop(loop);
      }
    },
    count(key) {counters[key]++;},
    sample(key,value) {add(histograms[key],value);},
    timeouts(count) {
      if(count>0) counters.timeoutTicks++;
      if(count>1) counters.multiSeatTimeoutTicks++;
      counters.maxTimeoutsPerTick=Math.max(counters.maxTimeoutsPerTick,count);
    },
    action(id,latency,offset,budget,fallback) {
      const seat=seats[id];
      seat.responses++;
      seat.consecutiveTimeouts=fallback==='timeout'?seat.consecutiveTimeouts+1:0;
      seat.longestConsecutiveTimeouts=Math.max(seat.longestConsecutiveTimeouts,seat.consecutiveTimeouts);
      add(seat.responseMs,latency);
      add(seat.dispatchOffsetMs,offset);
      if(latency>budget) seat.overBudgetResponses++;
      if(fallback!==null) {
        seat.fallbacks++;
        const reason=knownFallbacks.has(fallback)?fallback:'other';
        seat.fallbackReasons[reason]=(seat.fallbackReasons[reason]??0)+1;
      } else {
        seat.accepted++;
        if(latency>budget) seat.overBudgetAccepted++;
      }
    },
    finish(outcome) {
      if(summary) return summary;
      loop.disable();
      summary={schemaVersion:1,matchId,game,rulesVersion,tickRate,mode,
        seatCount:seatIds.length,createdAt,outcome,startup,
        host:{...counters,wholeMatch:usage(cpu,elu,at),combat:combatUsage,eventLoopDelayMs:combatLoop,
          ...Object.fromEntries(phases.map(phase=>[phase,summarize(histograms[phase])]))},
        seats:Object.fromEntries(seatIds.map(id=>{
          const {responseMs,dispatchOffsetMs,consecutiveTimeouts:_current,spawnAt:_spawnAt,...rest}=seats[id];
          return [id,{...rest,responseMs:summarize(responseMs),dispatchOffsetMs:summarize(dispatchOffsetMs)}];
        }))};
      return summary;
    }
  };
}

export async function saveMatchPerformance(root,report) {
  const dir=join(root,'log');
  const pending=join(dir,'.'+report.matchId+'.perf.tmp');
  try {
    await mkdir(dir,{recursive:true});
    await writeFile(pending,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    await rename(pending,join(dir,report.matchId+'.perf.json'));
  } catch(error) {
    await rm(pending,{force:true}).catch(()=>{});
    // Diagnostics must never block or change the match outcome on I/O failure.
    console.warn('Arena: 无法写入本地性能日志 ('+(error?.code??'write_error')+')');
  }
}
