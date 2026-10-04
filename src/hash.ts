import { InvalidJobError } from "./errors.js";

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

export function fnv1aShard(key: string, shardCount: number): number {
  if (shardCount < 1 || key.length === 0) {
    throw new InvalidJobError("fnv1aShard requires a non-empty key and shardCount >= 1");
  }
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), FNV_PRIME) >>> 0;
  }
  return h % shardCount;
}
