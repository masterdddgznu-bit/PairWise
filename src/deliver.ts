import type { Message, VectorClock } from "./types.js";

export function canDeliver(
  m: Message,
  local: VectorClock,
): boolean {
  const s = m.sender;
  if (m.vc[s] !== (local[s] ?? 0) + 1) return false;
  for (const k of Object.keys(m.vc)) {
    if (k !== s && m.vc[k] > (local[k] ?? 0)) return false;
  }
  return true;
}

export function applyDeliver(local: VectorClock, m: Message): void {
  local[m.sender] = (local[m.sender] ?? 0) + 1;
}
