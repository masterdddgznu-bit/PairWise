import type { VersionVector } from "./types.js";

export function vvGet(vv: VersionVector, id: string): number {
  return vv[id] ?? 0;
}

export function vvBump(vv: VersionVector, id: string, counter: number): VersionVector {
  const cur = vvGet(vv, id);
  if (counter <= cur) return { ...vv };
  return { ...vv, [id]: counter };
}

/** Per-dimension maximum of two version vectors. */
export function vvMergeMax(a: VersionVector, b: VersionVector): VersionVector {
  let out = { ...a };
  for (const [id, counter] of Object.entries(b)) {
    if (counter > vvGet(out, id)) out = { ...out, [id]: counter };
  }
  return out;
}

export function vvMin(vvs: VersionVector[]): VersionVector {
  if (vvs.length === 0) return {};
  const keys = new Set<string>();
  for (const v of vvs) for (const k of Object.keys(v)) keys.add(k);
  const out: VersionVector = {};
  for (const k of keys) {
    out[k] = Math.min(...vvs.map((v) => vvGet(v, k)));
  }
  return out;
}
