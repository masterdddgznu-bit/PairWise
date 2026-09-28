import type { Dot, TagView } from "./types.js";
import { sameDot, sortDots } from "./dot.js";
import { vvBump } from "./vv.js";

type ElemEntry = {
  live: Dot[];
  tomb: Dot[];
};

export class TagStore {
  private readonly elems = new Map<string, ElemEntry>();
  /** Highest counter ever observed per replica (survives GC). */
  private vv: Record<string, number> = {};

  addTag(elem: string, dot: Dot): void {
    const entry = this.entry(elem);
    if (!entry.live.some((d) => sameDot(d, dot)) && !entry.tomb.some((d) => sameDot(d, dot))) {
      entry.live.push(dot);
    }
    this.vv = vvBump(this.vv, dot.replicaId, dot.counter);
  }

  tombstoneAllLive(elem: string): boolean {
    const entry = this.elems.get(elem);
    if (!entry || entry.live.length === 0) return false;
    for (const dot of entry.live) {
      if (!entry.tomb.some((d) => sameDot(d, dot))) entry.tomb.push(dot);
    }
    entry.live = [];
    return true;
  }

  tombstoneTag(elem: string, dot: Dot): void {
    const entry = this.entry(elem);
    entry.live = entry.live.filter((d) => !sameDot(d, dot));
    if (!entry.tomb.some((d) => sameDot(d, dot))) entry.tomb.push(dot);
    this.vv = vvBump(this.vv, dot.replicaId, dot.counter);
  }

  has(elem: string): boolean {
    return (this.elems.get(elem)?.live.length ?? 0) > 0;
  }

  values(): string[] {
    return [...this.elems.keys()].filter((e) => this.has(e)).sort();
  }

  size(): number {
    return this.values().length;
  }

  getTags(elem: string): TagView {
    const entry = this.elems.get(elem);
    return {
      live: entry ? sortDots(entry.live) : [],
      tomb: entry ? sortDots(entry.tomb) : [],
    };
  }

  mergeFrom(other: TagStore): void {
    for (const { elem, live, tomb } of other.allTagged()) {
      const entry = this.entry(elem);
      for (const dot of live) {
        const knownTomb = entry.tomb.some((d) => sameDot(d, dot));
        const otherTomb = tomb.some((d) => sameDot(d, dot));
        if (knownTomb || otherTomb) {
          entry.live = entry.live.filter((d) => !sameDot(d, dot));
          if (!knownTomb) entry.tomb.push(dot);
        } else if (!entry.live.some((d) => sameDot(d, dot))) {
          entry.live.push(dot);
        }
      }
      for (const dot of tomb) {
        entry.live = entry.live.filter((d) => !sameDot(d, dot));
        if (!entry.tomb.some((d) => sameDot(d, dot))) entry.tomb.push(dot);
      }
    }
    for (const [id, counter] of Object.entries(other.versionVector())) {
      this.vv = vvBump(this.vv, id, counter);
    }
  }

  allTagged(): { elem: string; live: Dot[]; tomb: Dot[] }[] {
    return [...this.elems.entries()].map(([elem, entry]) => ({
      elem,
      live: [...entry.live],
      tomb: [...entry.tomb],
    }));
  }

  versionVector(): Record<string, number> {
    return { ...this.vv };
  }

  gcTombstones(pred: (dot: Dot) => boolean): number {
    let removed = 0;
    for (const [elem, entry] of this.elems) {
      const kept: Dot[] = [];
      for (const dot of entry.tomb) {
        if (pred(dot)) {
          removed++;
        } else {
          kept.push(dot);
        }
      }
      entry.tomb = kept;
      if (entry.live.length === 0 && entry.tomb.length === 0) {
        this.elems.delete(elem);
      }
    }
    return removed;
  }

  private entry(elem: string): ElemEntry {
    let entry = this.elems.get(elem);
    if (!entry) {
      entry = { live: [], tomb: [] };
      this.elems.set(elem, entry);
    }
    return entry;
  }
}
