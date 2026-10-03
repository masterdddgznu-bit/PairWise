import type { PinBook } from "./pins.js";
import type { VersionStore } from "./versions.js";

export function collect(versions: VersionStore, pins: PinBook): number {
  const pinEpochs = pins.epochs();
  let removed = 0;
  for (const key of versions.allKeys()) {
    const chain = versions.chain(key);
    for (let i = 0; i < chain.length - 1; i++) {
      const e = chain[i].epoch;
      const e2 = chain[i + 1].epoch;
      const needed = pinEpochs.some((p) => p >= e && p < e2);
      if (!needed && versions.removeAt(key, e)) removed++;
    }
  }
  return removed;
}
