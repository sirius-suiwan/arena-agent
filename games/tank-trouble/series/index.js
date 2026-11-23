const BREAK_TICKS = 60;
const DEFAULT_SCORE = 3;

// The platform ends a finite series; it does not own tank rules.
export function withClassicSeries(roundGame) {
  const roundInput = (series,round) => ({
    seed:round === 1 ? series.seed : JSON.stringify([series.seed,round]),
    config:series.config,players:series.players
  });

  function freshRound(series,round,scores,tick) {
    const state = roundGame.init(roundInput(series,round));
    return {...state,tick,roundTick:0,round,scores,targetScore:series.scoreToWin,
      phase:'playing',roundWinner:null,intermission:0,series};
  }

  return Object.freeze({
    ...roundGame,
    defaultMatchTicks:8400,
    init({seed,config={},players}) {
      const {scoreToWin=DEFAULT_SCORE,...roundConfig}=config;
      if (!Number.isInteger(scoreToWin)||scoreToWin<1||scoreToWin>10) throw new Error('scoreToWin must be 1–10');
      const series={seed,config:roundConfig,players:[...players],scoreToWin};
      return freshRound(series,1,Object.fromEntries(players.map(id=>[id,0])),0);
    },
    observe(state,playerId) {
      const observation = roundGame.observe({...state,tick:state.roundTick},playerId);
      return {...observation,tick:state.tick,roundTick:state.roundTick,round:state.round,
        scores:{...state.scores},targetScore:state.targetScore,phase:state.phase};
    },
    step(state,actions) {
      if (state.result) throw new Error('cannot step a finished series');
      const tick=state.tick+1;
      if (state.phase==='intermission') {
        if (state.intermission>1) return {state:{...state,tick,intermission:state.intermission-1},events:[],result:null};
        const round=state.round+1;
        return {state:freshRound(state.series,round,state.scores,tick),
          events:[{type:'round-start',round,scores:state.scores}],result:null};
      }
      const {tick:globalTick,roundTick,round,scores,targetScore,phase,roundWinner,intermission,series,...roundState}=state;
      const next=roundGame.step({...roundState,tick:roundTick},actions);
      const events=[...next.events];
      const current={...next.state,tick,roundTick:next.state.tick,round,scores,targetScore,phase,roundWinner,intermission,series,result:null};
      if (!next.result) return {state:current,events,result:null};
      const winner=next.result.winner;
      const scored=winner==null ? scores : {...scores,[winner]:scores[winner]+1};
      events.push({type:'round-end',round,winner,scores:scored,reason:next.result.reason});
      const result=winner!=null && scored[winner]>=targetScore
        ? {winner,reason:'score-target',scores:scored} : null;
      return {state:{...current,scores:scored,phase:result?'finished':'intermission',
        roundWinner:winner,intermission:result?0:BREAK_TICKS,result},events,result};
    }
  });
}
