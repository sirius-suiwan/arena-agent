const neutralAction = () => ({jump:false});
export const jumpGame = {
  id:'jump-fixture',version:'1',tickRate:10,neutralAction,
  init:({seed,players}) => ({tick:0,seed,players,heights:Object.fromEntries(players.map(id=>[id,0]))}),
  observe:(state,id) => ({height:state.heights[id]}),
  validateAction(action) {
    if (typeof action?.jump !== 'boolean') throw new Error('jump must be boolean');
    return {jump:action.jump};
  },
  step(state,actions) {
    const heights = Object.fromEntries(state.players.map(id=>[id,Number(actions[id].jump)]));
    return {state:{...state,tick:state.tick+1,heights},events:[],result:null};
  }
};
