import type { Message, VectorClock } from "./types.js";

export function canDeliver(
  m: Message,
  local: VectorClock,
): boolean {
  if (m.vc[m.sender] !== local[m.sender] + 1) return false;
  for (const k of Object.keys(local)) {
    if (k !== m.sender && m.vc[k] > local[k]) return false;
  }
  return true;
}

export function applyDeliver(local: VectorClock, m: Message): void {
  local[m.sender] = m.vc[m.sender];
}
