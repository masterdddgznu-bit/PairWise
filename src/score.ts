import { fnv32ForNode } from "./hash.js";

/** Integer rendezvous score (BigInt, no float drift). */
export function rendezvousScore(
  seed: number,
  key: string,
  nodeId: string,
  weight: number,
): bigint {
  const h = fnv32ForNode(seed, key, nodeId);
  const wMilli = BigInt(Math.floor(weight * 1000));
  return BigInt(h) * wMilli;
}
