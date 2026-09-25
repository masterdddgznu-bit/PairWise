import { Acl, type AclRule } from "./acl.js";
import { Router, type RouteRule } from "./router.js";
import { Shard } from "./shard.js";
import { Coordinator } from "./coord.js";

export interface DbOptions {
  shards: Record<string, Shard>;
  routing: RouteRule[];
  acl: AclRule[];
}

export interface DbStats {
  active: number;
  committed: number;
  aborted: number;
  shardPrepared: number;
}

/**
 * 门面 API。起始实现未完成。
 */
export class Db {
  constructor(_opts: DbOptions) {
    throw new Error("not implemented");
  }

  begin(_user: string): number {
    throw new Error("not implemented");
  }

  get(_tx: number, _key: string): string | undefined {
    throw new Error("not implemented");
  }

  put(_tx: number, _key: string, _value: string): void {
    throw new Error("not implemented");
  }

  commit(_tx: number): void {
    throw new Error("not implemented");
  }

  abort(_tx: number): void {
    throw new Error("not implemented");
  }

  stats(): DbStats {
    throw new Error("not implemented");
  }
}

// re-export for tests that touch modules directly
export { Acl, Router, Shard, Coordinator };
