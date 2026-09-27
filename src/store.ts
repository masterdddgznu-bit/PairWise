import type { BackendStore } from "./types.js";

export class StoreAdapter {
  private store: BackendStore | null = null;

  attach(store: BackendStore): void {
    this.store = store;
  }

  get(key: string): string | null {
    return this.store ? this.store.get(key) : null;
  }

  set(key: string, value: string): void {
    this.store?.set(key, value);
  }

  delete(key: string): void {
    this.store?.delete(key);
  }
}
