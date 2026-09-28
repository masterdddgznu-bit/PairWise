import type { MapRoot } from "./root.js";

/**
 * Roots hold the strong references to version nodes. Releasing a root
 * decrements every node it references; the VersionPool frees any node
 * whose count reaches zero immediately (reference-counting GC).
 */
export function retainRoot(root: MapRoot): void {
  root.retainAll();
}

export function releaseRoot(root: MapRoot): void {
  root.releaseAll();
}

/**
 * Retains the replacement root before releasing HEAD, so nodes shared by
 * both never transiently hit a zero refcount during fork.
 */
export function replaceHead(head: MapRoot, source: MapRoot): void {
  head.replaceWith(source);
}
