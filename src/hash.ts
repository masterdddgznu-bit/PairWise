import { InvalidJobError } from "./errors.js";

export function fnv1aShard(key: string, shardCount: number): number {
  if (shardCount < 1 || key.length === 0) {
    throw new InvalidJobError("fnv1aShard requires a non-empty key and shardCount >= 1");
  }
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h = (h ^ key.charCodeAt(i)) * 16777619 >>> 0;
  }
  return h % shardCount;
}
