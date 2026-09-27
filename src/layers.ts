import { LayerError, LayerExistsError } from "./errors.js";
import type { LayerEntry, VersionedValue } from "./types.js";

/**
 * Layer stack with top-down overlay resolution. A non-null value in a
 * higher layer shadows lower layers; a tombstone (null value) hides the key.
 */

export type LayerState = {
  order: string[];
  writeLayer: string;
  data: Map<string, Map<string, LayerEntry>>;
};

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

  assertLayer(name: string): void {
    if (!this.data.has(name)) {
      throw new LayerError(`Unknown layer: ${name}`);
    }
  }

  pushLayer(name: string): void {
    if (this.data.has(name)) {
      throw new LayerExistsError(`Layer already exists: ${name}`);
    }
    this.order.push(name);
    this.data.set(name, new Map());
    this.writeLayer = name;
  }

  popLayer(): void {
    if (this.order.length <= 1) {
      throw new LayerError("Cannot pop the base layer");
    }
    const name = this.order.pop()!;
    this.data.delete(name);
    this.writeLayer = this.order[this.order.length - 1];
  }

  setOn(layer: string, key: string, value: string, revision: number): void {
    this.assertLayer(layer);
    this.data.get(layer)!.set(key, { value, revision });
  }

  /** Write a tombstone unconditionally (used by TTL expiry). */
  tombstone(layer: string, key: string, revision: number): void {
    this.assertLayer(layer);
    this.data.get(layer)!.set(key, { value: null, revision });
  }

  /**
   * Write a tombstone on the given layer. Returns false when the key is not
   * visible from any layer (nothing to delete) or is already tombstoned.
   */
  deleteOn(layer: string, key: string, revision: number): boolean {
    this.assertLayer(layer);
    if (!this.resolve(key)) return false;
    this.data.get(layer)!.set(key, { value: null, revision });
    return true;
  }

  resolve(key: string): VersionedValue | null {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const e = this.data.get(this.order[i])!.get(key);
      if (e !== undefined) {
        if (e.value === null) return null;
        return { value: e.value, revision: e.revision };
      }
    }
    return null;
  }

  listKeys(): string[] {
    const visible = new Map<string, VersionedValue>();
    for (const layer of this.order) {
      for (const [key, e] of this.data.get(layer)!) {
        if (e.value === null) {
          visible.delete(key);
        } else {
          visible.set(key, { value: e.value, revision: e.revision });
        }
      }
    }
    return [...visible.keys()].sort();
  }

  cloneState(): LayerState {
    const data = new Map<string, Map<string, LayerEntry>>();
    for (const [name, m] of this.data) {
      const copy = new Map<string, LayerEntry>();
      for (const [key, e] of m) {
        copy.set(key, { value: e.value, revision: e.revision });
      }
      data.set(name, copy);
    }
    return { order: [...this.order], writeLayer: this.writeLayer, data };
  }

  restoreState(state: LayerState): void {
    this.data.clear();
    for (const [name, m] of state.data) {
      const copy = new Map<string, LayerEntry>();
      for (const [key, e] of m) {
        copy.set(key, { value: e.value, revision: e.revision });
      }
      this.data.set(name, copy);
    }
    this.order = [...state.order];
    this.writeLayer = state.writeLayer;
  }

  hasLayer(name: string): boolean {
    return this.data.has(name);
  }
}
