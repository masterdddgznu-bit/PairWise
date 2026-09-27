import type { Delivered } from "./types.js";
import type { WindowSlots } from "./window.js";

/** Pop contiguous prefix starting at expect. */
export function deliverContiguous(
  slots: WindowSlots,
  expect: number,
): { delivered: Delivered[]; newExpect: number } {
  const delivered: Delivered[] = [];
  let newExpect = expect;
  for (;;) {
    const pkt = slots.take(newExpect);
    if (pkt === null) break;
    delivered.push({ seq: pkt.seq, payload: pkt.payload });
    newExpect += 1;
  }
  return { delivered, newExpect };
}
