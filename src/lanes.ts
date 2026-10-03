import type { LaneMeta } from "./types.js";
import type { PageStore } from "./pages.js";

export class LaneBook {
  private readonly map = new Map<string, LaneMeta>();

  set(meta: LaneMeta): void {
    this.map.set(meta.name, meta);
  }

  get(name: string): LaneMeta | undefined {
    return this.map.get(name);
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  delete(name: string): LaneMeta | undefined {
    const m = this.map.get(name);
    if (!m) return undefined;
    this.map.delete(name);
    return m;
  }

  names(): string[] {
    return [...this.map.keys()].sort();
  }

  nonHeadCount(): number {
    let n = 0;
    for (const m of this.map.values()) {
      if (m.kind !== "head") n += 1;
    }
    return n;
  }

  cloneEntries(from: LaneMeta, pages: PageStore): Map<string, number> {
    const entries = new Map<string, number>();
    for (const [key, pageId] of from.entries) {
      pages.retain(pageId);
      entries.set(key, pageId);
    }
    return entries;
  }

  expired(now: number): string[] {
    const out: string[] = [];
    for (const m of this.map.values()) {
      if (m.kind === "snapshot" && m.deadline !== null && now >= m.deadline) {
        out.push(m.name);
      }
    }
    return out.sort();
  }
}
