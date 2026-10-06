import type { Hlc } from "./types.js";

export function isHlc(x: unknown): x is Hlc {
  if (typeof x !== "object" || x === null) return false;
  const h = x as Record<string, unknown>;
  return (
    Number.isInteger(h.pt) &&
    (h.pt as number) >= 0 &&
    Number.isInteger(h.lc) &&
    (h.lc as number) >= 0
  );
}

export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.pt !== b.pt) return a.pt < b.pt ? -1 : 1;
  if (a.lc !== b.lc) return a.lc < b.lc ? -1 : 1;
  return 0;
}

export function hlcLeq(a: Hlc, b: Hlc): boolean {
  return compareHlc(a, b) <= 0;
}

export function tickHlc(local: Hlc, now: number): Hlc {
  if (now > local.pt) return { pt: now, lc: 0 };
  return { pt: local.pt, lc: local.lc + 1 };
}

export function mergeHlc(local: Hlc, remote: Hlc, now: number): Hlc {
  const pt = Math.max(local.pt, remote.pt, now);
  let lc: number;
  if (pt === local.pt && pt === remote.pt) {
    lc = Math.max(local.lc, remote.lc) + 1;
  } else if (pt === local.pt) {
    lc = local.lc + 1;
  } else if (pt === remote.pt) {
    lc = remote.lc + 1;
  } else {
    lc = 0;
  }
  return { pt, lc };
}
