import type { Message, VectorClock } from "./types.js";

export function canDeliver(
  _m: Message,
  _local: VectorClock,
): boolean {
  return false;
}

export function applyDeliver(_local: VectorClock, _m: Message): void {}
