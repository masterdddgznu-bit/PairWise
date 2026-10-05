import type { WindowEntry } from "./registry.js";

/**
 * Victim selection: lowest priority first; ties broken by earliest
 * first-add (entries are iterated in first-add order).
 */
export function pickVictim(entries: WindowEntry[]): WindowEntry | undefined {
  let victim: WindowEntry | undefined;
  for (const entry of entries) {
    if (victim === undefined || entry.priority < victim.priority) {
      victim = entry;
    }
  }
  return victim;
}
