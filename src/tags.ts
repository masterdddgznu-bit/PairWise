import type { Dot, TagView } from "./types.js";
import { cmpDot } from "./dot.js";

type ElemTags = {
  live: Map<string, Dot>;
  tomb: Map<string, Dot>;
};

export function dotKey(dot: Dot): string {
  return `${dot.replicaId}#${dot.counter}`;
}

export class TagStore {
  private readonly elems = new Map<string, ElemTags>();

  private entry(elem: string): ElemTags {
    let e = this.elems.get(elem);
    if (e === undefined) {
      e = { live: new Map(), tomb: new Map() };
      this.elems.set(elem, e);
    }
    return e;
  }

  /** Record a live tag. A tombstone for the same dot always wins. */
  addTag(elem: string, dot: Dot): void {
    const e = this.entry(elem);
    const k = dotKey(dot);
    if (e.tomb.has(k)) return;
    if (!e.live.has(k)) e.live.set(k, { ...dot });
  }

  /** Tombstone a specific dot (from a remove delta / merge). */
  tombstoneDot(elem: string, dot: Dot): void {
    const e = this.entry(elem);
    const k = dotKey(dot);
    e.live.delete(k);
    if (!e.tomb.has(k)) e.tomb.set(k, { ...dot });
  }

  /** Local remove: tombstone every currently live tag of elem. */
  tombstoneAllLive(elem: string): boolean {
    const e = this.elems.get(elem);
    if (e === undefined || e.live.size === 0) return false;
    for (const [k, dot] of e.live) e.tomb.set(k, dot);
    e.live.clear();
    return true;
  }

  has(_elem: string): boolean {
    const e = this.elems.get(_elem);
    return e !== undefined && e.live.size > 0;
  }

  values(): string[] {
    return [...this.elems.keys()]
      .filter((elem) => this.has(elem))
      .sort();
  }

  size(): number {
    let n = 0;
    for (const e of this.elems.values()) if (e.live.size > 0) n++;
    return n;
  }

  getTags(_elem: string): TagView {
    const e = this.elems.get(_elem);
    if (e === undefined) return { live: [], tomb: [] };
    return {
      live: [...e.live.values()].sort(cmpDot),
      tomb: [...e.tomb.values()].sort(cmpDot),
    };
  }

  mergeFrom(_other: TagStore): void {
    for (const [elem, other] of _other.elems) {
      const mine = this.entry(elem);
      // Tombstones on either side win for that dot.
      for (const [k, dot] of other.tomb) {
        mine.live.delete(k);
        if (!mine.tomb.has(k)) mine.tomb.set(k, { ...dot });
      }
      // Live tags survive unless already tombstoned on this side.
      for (const [k, dot] of other.live) {
        if (mine.tomb.has(k) || mine.live.has(k)) continue;
        mine.live.set(k, { ...dot });
      }
    }
  }

  allTagged(): { elem: string; live: Dot[]; tomb: Dot[] }[] {
    const out: { elem: string; live: Dot[]; tomb: Dot[] }[] = [];
    for (const [elem, e] of this.elems) {
      out.push({
        elem,
        live: [...e.live.values()].sort(cmpDot),
        tomb: [...e.tomb.values()].sort(cmpDot),
      });
    }
    out.sort((a, b) => (a.elem < b.elem ? -1 : a.elem > b.elem ? 1 : 0));
    return out;
  }

  gcTombstones(_pred: (dot: Dot) => boolean): number {
    let removed = 0;
    for (const [elem, e] of this.elems) {
      for (const [k, dot] of e.tomb) {
        if (_pred(dot)) {
          e.tomb.delete(k);
          removed++;
        }
      }
      if (e.live.size === 0 && e.tomb.size === 0) this.elems.delete(elem);
    }
    return removed;
  }
}
