import { LayerError, LayerExistsError } from "./errors.js";
import type { LayerEntry, VersionedValue } from "./types.js";

export type LayerData = {
  order: string[];
  writeLayer: string;
  data: Map<string, Map<string, LayerEntry>>;
};

/** Layer stack; `order` runs bottom -> top, top layer is the write layer. */
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
      throw new LayerError("Cannot pop the only layer (base)");
    }
    const name = this.order.pop()!;
    this.data.delete(name);
    this.writeLayer = this.order[this.order.length - 1];
  }

  setOn(layer: string, key: string, value: string, revision: number): void {
    const map = this.data.get(layer);
    if (!map) {
      throw new LayerError(`Unknown layer: ${layer}`);
    }
    map.set(key, { value, revision });
  }

  deleteOn(layer: string, key: string, revision: number): boolean {
    const map = this.data.get(layer);
    if (!map) {
      throw new LayerError(`Unknown layer: ${layer}`);
    }
    map.set(key, { value: null, revision });
    return true;
  }

  resolve(key: string): VersionedValue | null {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const entry = this.data.get(this.order[i])!.get(key);
      if (entry) {
        return entry.value === null
          ? null
          : { value: entry.value, revision: entry.revision };
      }
    }
    return null;
  }

  listKeys(): string[] {
    const seen = new Set<string>();
    const visible = new Set<string>();
    for (let i = this.order.length - 1; i >= 0; i--) {
      for (const [key, entry] of this.data.get(this.order[i])!) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (entry.value !== null) visible.add(key);
      }
    }
    return [...visible].sort();
  }

  cloneData(): LayerData {
    return {
      order: [...this.order],
      writeLayer: this.writeLayer,
      data: this.copyData(this.data),
    };
  }

  replaceAll(state: LayerData): void {
    this.order = [...state.order];
    this.writeLayer = state.writeLayer;
    this.data.clear();
    for (const [name, map] of this.copyData(state.data)) {
      this.data.set(name, map);
    }
  }

  hasLayer(name: string): boolean {
    return this.data.has(name);
  }

  private copyData(
    source: Map<string, Map<string, LayerEntry>>,
  ): Map<string, Map<string, LayerEntry>> {
    const copy = new Map<string, Map<string, LayerEntry>>();
    for (const [name, map] of source) {
      const layerCopy = new Map<string, LayerEntry>();
      for (const [key, entry] of map) {
        layerCopy.set(key, { value: entry.value, revision: entry.revision });
      }
      copy.set(name, layerCopy);
    }
    return copy;
  }
}
