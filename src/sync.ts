import type { DiffOp, Entry } from "./types.js";

export function diffEntries(local: Entry[], remote: Entry[]): DiffOp[] {
  const localMap = new Map(local.map((e) => [e.key, e]));
  const remoteMap = new Map(remote.map((e) => [e.key, e]));
  const keys = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);
  const ops: DiffOp[] = [];
  for (const key of keys) {
    const localEntry = localMap.get(key);
    const w = winner(localEntry, remoteMap.get(key));
    if (!w) continue;
    if (
      !localEntry ||
      localEntry.ver !== w.ver ||
      localEntry.deleted !== w.deleted ||
      localEntry.value !== w.value
    ) {
      ops.push({ key, value: w.value, ver: w.ver, deleted: w.deleted });
    }
  }
  return ops.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function winner(
  a: Entry | undefined,
  b: Entry | undefined,
): Entry | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.ver !== b.ver) return a.ver > b.ver ? a : b;
  if (a.deleted !== b.deleted) return a.deleted ? a : b;
  return a.value >= b.value ? a : b;
}
