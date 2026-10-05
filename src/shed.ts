import type { Entry } from "./registry.js";

/**
 * Shed policy: victim is the in-window entry with the smallest
 * priority; ties go to the earliest first-add. `entries` must be
 * in first-add order.
 */
export function pickVictim(entries: Entry[]): Entry | null {
  let victim: Entry | null = null;
  for (const entry of entries) {
    if (victim === null || entry.priority < victim.priority) {
      victim = entry;
    }
  }
  return victim;
}
