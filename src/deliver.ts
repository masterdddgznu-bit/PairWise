import type { Delivered } from "./types.js";
import type { WindowSlots } from "./window.js";

/** Pop contiguous prefix starting at expect — stub. */
export function deliverContiguous(
  slots: WindowSlots,
  expect: number,
): { delivered: Delivered[]; newExpect: number } {
  const delivered: Delivered[] = [];
  let next = expect;
  for (;;) {
    const pkt = slots.take(next);
    if (pkt === null) break;
    delivered.push({ seq: pkt.seq, payload: pkt.payload });
    next += 1;
  }
  return { delivered, newExpect: next };
}
