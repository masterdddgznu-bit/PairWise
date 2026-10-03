import type { ResourceSpec } from "./types.js";

export class ResourceTree {
  constructor(_resources: ResourceSpec[]) {}
  has(_id: string): boolean { return false; }
  parentOf(_id: string): string | null { return null; }
  /** root → … → node (excluding node) */
  ancestors(_id: string): string[] { return []; }
  ids(): string[] { return []; }
}
