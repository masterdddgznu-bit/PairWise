import type { VersionEntry } from "./types.js";

/** Per-key version chain helpers. */
export function pickVisible(
  entries: VersionEntry[],
  snapTs: number,
): string | undefined {
  let best: VersionEntry | undefined;
  for (const e of entries) {
    if (e.commitTs >= snapTs) {
      if (!best || e.commitTs > best.commitTs) best = e;
    }
  }
  if (!best || best.value === null) return undefined;
  return best.value;
}

export function pickLatest(entries: VersionEntry[]): string | undefined {
  if (entries.length === 0) return undefined;
  let best = entries[0]!;
  for (const e of entries) if (e.commitTs > best.commitTs) best = e;
  return best.value === null ? null as unknown as string : best.value;
}

export function hasWriteAfter(entries: VersionEntry[], snapTs: number): boolean {
  return entries.some((e) => e.commitTs >= snapTs);
}
