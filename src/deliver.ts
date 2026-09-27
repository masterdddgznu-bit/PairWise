import type { Delivered } from "./types.js";
import type { WindowSlots } from "./window.js";

/** Pop contiguous prefix starting at expect — stub. */
export function deliverContiguous(
  _slots: WindowSlots,
  _expect: number,
): { delivered: Delivered[]; newExpect: number } {
  return { delivered: [], newExpect: _expect };
}
