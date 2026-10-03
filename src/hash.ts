const OFFSET = 0x811c9dc5;
const PRIME = 0x01000193;

export function fnv1a32(key: string): number {
  const bytes = new TextEncoder().encode(key);
  let h = OFFSET;
  for (const b of bytes) {
    h = Math.imul(h ^ b, PRIME) >>> 0;
  }
  return h >>> 0;
}

export function vnodeOf(key: string, vnodeCount: number): number {
  return fnv1a32(key) % vnodeCount;
}
