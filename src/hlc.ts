export interface Hlc {
  pt: number;
  lc: number;
}

export function isValidHlc(value: unknown): value is Hlc {
  if (typeof value !== "object" || value === null) return false;
  const h = value as Record<string, unknown>;
  return (
    Number.isInteger(h.pt) &&
    Number.isInteger(h.lc) &&
    (h.pt as number) >= 0 &&
    (h.lc as number) >= 0
  );
}

export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.pt !== b.pt) return a.pt < b.pt ? -1 : 1;
  if (a.lc !== b.lc) return a.lc < b.lc ? -1 : a.lc > b.lc ? 1 : 0;
  return 0;
}

export function copyHlc(h: Hlc): Hlc {
  return { pt: h.pt, lc: h.lc };
}
