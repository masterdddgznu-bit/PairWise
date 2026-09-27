import { PoolExistsError } from "./errors.js";
import type { ResourceState } from "./types.js";

export class ResourcePools {
  private readonly pools = new Map<string, ResourceState[]>();

  create(name: string, capacity: number): void {
    if (this.pools.has(name)) throw new PoolExistsError(`Pool exists: ${name}`);
    const resources: ResourceState[] = [];
    for (let i = 1; i <= capacity; i++) {
      resources.push({
        resourceId: `${name}-${i}`,
        holderId: null,
        token: 0,
        expireAt: null,
      });
    }
    this.pools.set(name, resources);
  }

  has(name: string): boolean {
    return this.pools.has(name);
  }

  get(name: string): ResourceState[] | undefined {
    return this.pools.get(name);
  }

  findFree(name: string): ResourceState | undefined {
    const list = this.pools.get(name);
    if (!list) return undefined;
    return list.find((r) => r.holderId === null);
  }

  find(name: string, resourceId: string): ResourceState | undefined {
    return this.pools.get(name)?.find((r) => r.resourceId === resourceId);
  }
}
