import type { DiffOp, Entry } from "./types.js";

export function winner(a: Entry | undefined, b: Entry | undefined): Entry | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.ver !== b.ver) return a.ver > b.ver ? a : b;
  if (a.deleted !== b.deleted) return a.deleted ? a : b;
  return a.value >= b.value ? a : b;
}

/** Ops the local side must write to adopt the winning state of every known key. */
export function diffEntries(local: Entry[], remote: Entry[]): DiffOp[] {
  const byKey = new Map<string, { local?: Entry; remote?: Entry }>();
  for (const entry of local) {
    byKey.set(entry.key, { ...byKey.get(entry.key), local: entry });
  }
  for (const entry of remote) {
    byKey.set(entry.key, { ...byKey.get(entry.key), remote: entry });
  }

  const ops: DiffOp[] = [];
  for (const key of [...byKey.keys()].sort()) {
    const pair = byKey.get(key)!;
    const w = winner(pair.local, pair.remote)!;
    const current = pair.local;
    const same =
      current !== undefined &&
      current.ver === w.ver &&
      current.deleted === w.deleted &&
      current.value === w.value;
    if (!same) {
      ops.push({
        key,
        value: w.deleted ? "" : w.value,
        ver: w.ver,
        deleted: w.deleted,
      });
    }
  }
  return ops;
}
