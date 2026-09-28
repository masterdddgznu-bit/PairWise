import type { Timestamp } from "./types.js";

export function cmpTs(a: Timestamp, b: Timestamp): number {
  if (a.num !== b.num) {
    return a.num < b.num ? -1 : 1;
  }
  if (a.writerId !== b.writerId) {
    return a.writerId < b.writerId ? -1 : 1;
  }
  return 0;
}

export function maxTs(a: Timestamp, b: Timestamp): Timestamp {
  return cmpTs(a, b) >= 0 ? a : b;
}
