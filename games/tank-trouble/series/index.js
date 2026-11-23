// The series owns the platform clock, intermissions and scorekeeping.
const BREAK_TICKS=60;
const SETTLEMENT_TICKS=180;
const DEFAULT_SCORE=3;
const DEFAULT_MATCH_TICKS=8400;

function seriesSettings(config) {
  if (!config || typeof config!=='object'||Array.isArray(config)) throw new Error('match config must be an object');
  const {scoreToWin=DEFAULT_SCORE,roundLimit=0,...roundConfig}=config;
  if (!Number.isInteger(scoreToWin)||scoreToWin<1||scoreToWin>10) throw new Error('scoreToWin must be 1–10');
  if (!Number.isInteger(roundLimit)||roundLimit<0||roundLimit>20) throw new Error('roundLimit must be 0–20');
  return {scoreToWin,roundLimit,roundConfig};
}

function teamSetup(players,teams,validate) {
  if (teams===undefined) return null;
  if (validate) teams=validate(teams,players);
  if (!teams||typeof teams!=='object'||Array.isArray(teams)||Object.keys(teams).length!==players.length||
      players.some(id=>!Object.hasOwn(teams,id)||!['1','2','3','4'].includes(teams[id]))) {
    throw new Error('teams must assign every active seat to exactly one team ID from 1 to 4');
  }
  const ids=[...new Set(players.map(id=>teams[id]))].sort();
  if (ids.length<2) throw new Error('team mode needs at least two distinct teams');
  return {assignments:Object.fromEntries(players.map(id=>[id,teams[id]])),scores:Object.fromEntries(ids.map(id=>[id,0]))};
}

function leadingScore(scores) {
  const pivot=Math.max(...Object.values(scores));
  const leaders=Object.keys(scores).filter(id=>scores[id]===pivot);
  return leaders.length===1?leaders[0]:null;
}

export function withClassicSeries(roundGame,{
  breakTicks=BREAK_TICKS,settlementTicks=SETTLEMENT_TICKS,defaultMatchTicks=DEFAULT_MATCH_TICKS
}={}) {
  function freshRound(series,round,scores,teamScores,tick) {
    const seed=round===1?series.seed:JSON.stringify([series.seed,round]);
    const state=roundGame.init({seed,config:series.config,players:series.players});
    return {...state,tick,roundTick:0,round,scores,teamScores,roundLimit:series.roundLimit,targetScore:series.scoreToWin,
      phase:'playing',roundWinner:null,roundWinnerTeam:null,intermission:0,series};
  }

  return Object.freeze({
    ...roundGame,
    defaultMatchTicks,
    matchTickLimit(config={}) {
      const {roundLimit,roundConfig}=seriesSettings(config);
      if (!roundLimit) return roundGame.matchTickLimit?.(roundConfig)??defaultMatchTicks;
      const max=roundGame.roundTickLimit?.(roundConfig)??roundConfig.maxTicks??3600;
      // A sole survivor can use the whole settlement period before scoring.
      // Only interrupted (non-final) rounds incur an intermission.
      return roundLimit*(max+settlementTicks)+(roundLimit-1)*breakTicks;
    },
    init({seed,config={},players}) {
      const {scoreToWin,roundLimit,roundConfig}=seriesSettings(config);
      const teams=teamSetup(players,roundConfig.teams,roundGame.validateTeams);
      if(teams) roundConfig.teams=teams.assignments;
      const series={seed,config:roundConfig,players:[...players],scoreToWin,roundLimit};
      return freshRound(series,1,Object.fromEntries(players.map(id=>[id,0])),teams?.scores??null,0);
    },
    observe(state,playerId) {
      const obs=roundGame.observe({...state,tick:state.roundTick},playerId);
      return {...obs,tick:state.tick,roundTick:state.roundTick,round:state.round,
        scores:{...state.scores},teamScores:state.teamScores?{...state.teamScores}:null,
        targetScore:state.targetScore,roundLimit:state.roundLimit,phase:state.phase,
        roundWinner:state.roundWinner,roundWinnerTeam:state.roundWinnerTeam};
    },
    step(state,actions) {
      if (state.result) throw new Error('cannot step a finished series');
      const tick=state.tick+1;
      if (state.phase==='intermission') {
        if (state.intermission>1) return {state:{...state,tick,intermission:state.intermission-1},events:[],result:null};
        const round=state.round+1;
        const fresh=freshRound(state.series,round,state.scores,state.teamScores,tick);
        return {state:fresh,events:[{type:'round-start',round,scores:state.scores,
          ...(state.teamScores?{teamScores:state.teamScores}:{})}],result:null};
      }
      const {tick:globalTick,roundTick,round,scores,teamScores,targetScore,roundLimit,phase,roundWinner,
        roundWinnerTeam,intermission,series,...roundState}=state;
      const next=roundGame.step({...roundState,tick:roundTick},actions);
      const events=[...next.events];
      const current={...next.state,tick,roundTick:next.state.tick,round,scores,teamScores,targetScore,roundLimit,
        phase,roundWinner,roundWinnerTeam,intermission,series,result:null};
      if (!next.result) return {state:current,events,result:null};
      const teamMode=teamScores!==null, winner=next.result.winner??null, winnerTeam=next.result.winnerTeam??null;
      if(teamMode ? winner!==null||winnerTeam!==null&&!Object.hasOwn(teamScores,winnerTeam)
        : winnerTeam!==null||winner!==null&&!Object.hasOwn(scores,winner)) {
        throw new Error('invalid round winner for series');
      }
      const scored=winner===null?scores:{...scores,[winner]:scores[winner]+1};
      const scoredTeams=winnerTeam===null?teamScores:{...teamScores,[winnerTeam]:teamScores[winnerTeam]+1};
      events.push({type:'round-end',round,winner,scores:scored,reason:next.result.reason,
        ...(teamMode?{winnerTeam,teamScores:scoredTeams}:{})});
      const leaders=teamMode?scoredTeams:scored;
      const roundVictor=teamMode?winnerTeam:winner;
      const finishReason=roundLimit>0
        ? (round>=roundLimit?'round-limit':null)
        : (roundVictor!==null&&leaders[roundVictor]>=targetScore?'score-target':null);
      const victor=finishReason==='round-limit'?leadingScore(leaders):roundVictor;
      const result=finishReason?{winner:teamMode?null:victor,reason:finishReason,scores:scored,
        ...(teamMode?{winnerTeam:victor,teamScores:scoredTeams}:{})}:null;
      return {state:{...current,scores:scored,teamScores:scoredTeams,phase:result?'finished':'intermission',
        roundWinner:winner,roundWinnerTeam:winnerTeam,intermission:result?0:breakTicks,result},events,result};
    }
  });
}
