import type { Saggar } from "./registry.js";

export function isLive(saggar: Saggar, now: number): boolean {
  return saggar.soakAt < now && now <= saggar.drawAt;
}

export function isSpent(saggar: Saggar, now: number): boolean {
  return now > saggar.drawAt;
}

export function compareRank(a: Saggar, b: Saggar): number {
  if (a.drawAt !== b.drawAt) return b.drawAt - a.drawAt;
  if (a.fire !== b.fire) return a.fire - b.fire;
  return a.seq - b.seq;
}
