// Wall-clock control only. The engine and replay never see a pause action.
export class MatchPause {
  #tick=0;
  #pending=null;
  #unblock=null;
  #paused=false;
  #closed=false;

  constructor(matchId,onChange=()=>{}) {
    this.matchId=matchId;
    this.onChange=onChange;
  }

  get paused() { return this.#paused; }
  get status() { return {paused:this.#paused,tick:this.#tick,matchId:this.matchId}; }

  setPaused(paused) {
    if (this.#closed) throw new Error('对局已结束');
    if (this.#pending) {
      if (paused) return this.#pending.promise;
      throw new Error('正在等待当前 tick 结束');
    }
    if (this.#paused===paused) return Promise.resolve(this.status);
    if (!paused) {
      this.#paused=false;
      this.onChange(this.status);
      this.#unblock?.();
      this.#unblock=null;
      return Promise.resolve(this.status);
    }
    let resolve,reject;
    const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
    this.#pending={promise,resolve,reject};
    return promise;
  }

  async checkpoint(tick) {
    this.#tick=tick;
    if (!this.#pending) return false;
    const pending=this.#pending;
    this.#pending=null;
    const resumed=new Promise(resolve=>{this.#unblock=resolve;});
    this.#paused=true;
    this.onChange(this.status);
    pending.resolve(this.status);
    await resumed;
    return true;
  }

  close() {
    this.#closed=true;
    this.#pending?.reject(new Error('对局已结束'));
    this.#pending=null;
    this.#unblock?.();
    this.#unblock=null;
  }
}
