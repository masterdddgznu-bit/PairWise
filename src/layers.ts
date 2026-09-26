import { LayerError, LayerExistsError } from "./errors.js";
import type { LayerEntry, VersionedValue } from "./types.js";

/**
 * Layer stack — starter: only `base` layer with working set/get/delete/list.
 * push/pop/setOn/deleteOn/tombstone overlay resolution unfinished.
 */
export class LayerStack {
  /** bottom -> top */
  private order: string[] = ["base"];
  private readonly data = new Map<string, Map<string, LayerEntry>>();
  private writeLayer = "base";

  constructor() {
    this.data.set("base", new Map());
  }

  layers(): string[] {
    return [...this.order];
  }

  currentWriteLayer(): string {
    return this.writeLayer;
  }

  pushLayer(_name: string): void {
    throw new Error("pushLayer not implemented");
  }

  popLayer(): void {
    throw new Error("popLayer not implemented");
  }

  setOn(layer: string, key: string, value: string, revision: number): void {
    if (layer !== "base" || !this.data.has(layer)) {
      // On starter, only base writes via set() path use internal setOnBase.
      throw new LayerError(`Unknown layer: ${layer}`);
    }
    this.data.get(layer)!.set(key, { value, revision });
  }

  /** Internal helper used by base set/delete on starter. */
  setOnBase(key: string, value: string | null, revision: number): void {
    this.data.get("base")!.set(key, { value, revision });
  }

  deleteOn(layer: string, key: string, revision: number): boolean {
    if (layer !== this.writeLayer || layer !== "base") {
      throw new Error("deleteOn not implemented");
    }
    const m = this.data.get("base")!;
    if (!m.has(key) || m.get(key)!.value === null) {
      // For base-only starter resolve: treat missing as no-op delete.
      if (!this.resolve(key)) return false;
    }
    m.set(key, { value: null, revision });
    return true;
  }

  resolve(key: string): VersionedValue | null {
    // Starter: only base, ignore tombstones as deletes.
    const e = this.data.get("base")!.get(key);
    if (!e || e.value === null) return null;
    return { value: e.value, revision: e.revision };
  }

  listKeys(): string[] {
    const keys: string[] = [];
    for (const [k, e] of this.data.get("base")!) {
      if (e.value !== null) keys.push(k);
    }
    return keys.sort();
  }

  /** Deep clone maps for snapshot — stub. */
  cloneData(): {
    order: string[];
    writeLayer: string;
    data: Map<string, Map<string, LayerEntry>>;
  } {
    throw new Error("cloneData not implemented");
  }

  replaceAll(_state: {
    order: string[];
    writeLayer: string;
    data: Map<string, Map<string, LayerEntry>>;
  }): void {
    throw new Error("replaceAll not implemented");
  }

  hasLayer(name: string): boolean {
    return this.data.has(name);
  }

  // silence reserved errors on starte
  reserved(): void {
    void LayerExistsError;
  }
}
