import {randomBytes} from 'node:crypto';

// Never reuse an automatically assigned seed within this running host or CLI batch.
const used = new Set();
export function randomMatchSeed() {
  let seed;
  do { seed = randomBytes(4).readUInt32BE(); } while (used.has(seed));
  used.add(seed);
  return seed;
}
