const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a32(key: string): number {
  const bytes = Buffer.from(key, "utf8");
  let h = FNV_OFFSET;
  for (const b of bytes) {
    h = Math.imul(h ^ b, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

export function vnodeOf(key: string, vnodeCount: number): number {
  return fnv1a32(key) % vnodeCount;
}
