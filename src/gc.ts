import type { LaneMeta } from "./types.js";
import type { PageStore } from "./pages.js";

export function releaseLane(meta: LaneMeta, pages: PageStore): void {
  for (const pageId of meta.entries.values()) {
    pages.release(pageId);
  }
  meta.entries.clear();
}

export function overwriteKey(
  meta: LaneMeta,
  pages: PageStore,
  key: string,
  pageId: number,
): void {
  const prev = meta.entries.get(key);
  if (prev !== undefined) pages.release(prev);
  meta.entries.set(key, pageId);
}

export function deleteKey(meta: LaneMeta, pages: PageStore, key: string): boolean {
  const prev = meta.entries.get(key);
  if (prev === undefined) return false;
  pages.release(prev);
  meta.entries.delete(key);
  return true;
}
