import { S_SNAPSHOT, type Snapshot, decodeSnapshot } from '@war/shared';
import type { Link } from '../src/room.js';

/** A client stand-in that counts the bytes the room would put on the wire. */
export class CountingLink implements Link {
  rtt = 40;
  bytes = 0;
  snapshots = 0;
  last: Snapshot | null = null;
  constructor(private decode = false) {}
  send(data: Uint8Array | string) {
    this.bytes += typeof data === 'string' ? data.length : data.length;
    if (typeof data !== 'string' && data[0] === S_SNAPSHOT) {
      this.snapshots++;
      if (this.decode) this.last = decodeSnapshot(data);
    }
  }
  close() {}
}

export function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
