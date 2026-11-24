import {spawn} from 'node:child_process';

const MAX = 64 * 1024;
// Starting a process can involve interpreter/module initialization and
// disk/cache contention across up to eight seats. This is not a tick budget.
const STARTUP_TIMEOUT_MS = 15_000;

export class LocalBot {
  constructor(command, args = []) {
    this.child = spawn(command, args, {stdio: ['pipe', 'pipe', 'inherit'], shell: false});
    this.dead = false;
    this.buffer = '';
    this.pending = null;
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.receive(chunk));
    for (const [target, event] of [[this.child,'error'], [this.child,'exit'], [this.child.stdin,'error'], [this.child.stdout,'end']]) {
      target.on(event, () => this.fail('process_exit'));
    }
  }

  fail(reason) {
    this.dead = true;
    this.settle({error: reason});
  }

  settle(value) {
    if (!this.pending) return;
    const {resolve,timer} = this.pending;
    this.pending = null;
    clearTimeout(timer);
    resolve(value);
  }

  receive(chunk) {
    if (this.dead) return;
    const lines = (this.buffer + chunk).split('\n');
    this.buffer = lines.pop();
    if (Buffer.byteLength(this.buffer) > MAX || lines.some(line => Buffer.byteLength(line) > MAX)) {
      this.fail('line_too_long');
      this.close();
      return;
    }
    for (const line of lines) {
      if (!this.pending) break;
      let reply;
      try { reply = JSON.parse(line); } catch { this.settle({error:'invalid_json'}); continue; }
      const {type, tick} = this.pending;
      if (type === 'action' && reply?.type === 'action' && Number.isInteger(reply.tick) && reply.tick < tick) continue;
      if (reply?.type !== type || (type === 'action' && reply.tick !== tick) ||
          (type === 'ready' && reply.protocol !== 1)) {
        this.settle({error:'protocol_mismatch'});
        continue;
      }
      this.settle(type === 'action' ? {value:reply.action}
        : typeof reply.name === 'string' ? {value:null,name:reply.name} : {value:null});
    }
  }

  request(message, type, timeoutMs) {
    if (this.dead) return Promise.resolve({error:'process_unavailable'});
    if (this.pending) throw new Error('bot already awaiting a reply');
    const line = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(line) > MAX) return Promise.resolve({error:'observation_too_large'});
    return new Promise(resolve => {
      const timer = setTimeout(() => this.settle({error:'timeout'}), timeoutMs);
      this.pending = {resolve,timer,type,tick:message.tick};
      if (this.child.stdin.writableNeedDrain) {
        this.settle({error:'backpressure'});
      } else {
        this.child.stdin.write(line);
      }
    });
  }

  async start(message,{signal}={}) {
    const abort = () => this.settle({error:'startup_aborted'});
    if (signal?.aborted) {
      this.close();
      return {error:'startup_aborted'};
    }
    signal?.addEventListener('abort',abort,{once:true});
    try {
      const result = await this.request(message, 'ready', STARTUP_TIMEOUT_MS);
      if (result.error) this.close();
      return result.error==='timeout'?{error:'startup_timeout'}:result;
    } finally {
      signal?.removeEventListener('abort',abort);
    }
  }

  act(message, timeoutMs) { return this.request(message, 'action', timeoutMs); }

  close() {
    this.fail('closed');
    this.child.stdin.destroy();
    this.child.stdout.destroy();
    // Direct children only: this transport is not a sandbox.
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
  }
}
