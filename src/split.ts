/**
 * Locked split rule: after overflow a node holds maxKeys + 1 keys;
 * the left node keeps keys[0..splitAt-1] and the right node starts at
 * keys[splitAt], which is also the promoted separator.
 */
export function splitAtIndex(maxKeys: number): number {
  return Math.floor((maxKeys + 1) / 2);
}
