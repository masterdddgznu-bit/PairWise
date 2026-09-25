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

type TxState = "active" | "committed" | "aborted";

interface Tx {
  user: string;
  state: TxState;
  buffer: Map<string, string>;
}

/**
 * 门面 API。
 */
export class Db {
  private readonly shards: Record<string, Shard>;
  private readonly router: Router;
  private readonly acl: Acl;
  private readonly coord: Coordinator;
  private readonly txs = new Map<number, Tx>();
  private nextTx = 1;
  private committedCount = 0;
  private abortedCount = 0;

  constructor(opts: DbOptions) {
    this.shards = opts.shards;
    this.router = new Router(opts.routing);
    this.acl = new Acl(opts.acl);
    this.coord = new Coordinator(opts.shards);
  }

  begin(user: string): number {
    const tx = this.nextTx++;
    this.txs.set(tx, { user, state: "active", buffer: new Map() });
    return tx;
  }

  private activeTx(tx: number): Tx {
    const t = this.txs.get(tx);
    if (t === undefined || t.state !== "active") {
      throw new Error(`tx not active: ${tx}`);
    }
    return t;
  }

  get(tx: number, key: string): string | undefined {
    const t = this.activeTx(tx);
    if (!this.acl.check(t.user, "read", key)) {
      throw new Error(`read denied for user ${t.user} on key ${key}`);
    }
    if (t.buffer.has(key)) {
      return t.buffer.get(key);
    }
    return this.shards[this.router.shardOf(key)].get(key);
  }

  put(tx: number, key: string, value: string): void {
    const t = this.activeTx(tx);
    if (!this.acl.check(t.user, "write", key)) {
      throw new Error(`write denied for user ${t.user} on key ${key}`);
    }
    t.buffer.set(key, value);
  }

  commit(tx: number): void {
    const t = this.activeTx(tx);
    const writeSet: Record<string, Record<string, string>> = {};
    for (const [key, value] of t.buffer) {
      const shardId = this.router.shardOf(key);
      (writeSet[shardId] ??= {})[key] = value;
    }
    const result = this.coord.commit(tx, writeSet);
    if (result === "aborted") {
      t.state = "aborted";
      this.abortedCount++;
      throw new Error(`commit aborted for tx ${tx}`);
    }
    t.state = "committed";
    this.committedCount++;
  }

  abort(tx: number): void {
    const t = this.activeTx(tx);
    const shardIds = this.router.shardsOf([...t.buffer.keys()]);
    this.coord.abortPrepared(tx, shardIds);
    t.buffer.clear();
    t.state = "aborted";
    this.abortedCount++;
  }

  stats(): DbStats {
    let active = 0;
    for (const t of this.txs.values()) {
      if (t.state === "active") {
        active++;
      }
    }
    let shardPrepared = 0;
    for (const shard of Object.values(this.shards)) {
      shardPrepared += shard.stats().prepared;
    }
    return {
      active,
      committed: this.committedCount,
      aborted: this.abortedCount,
      shardPrepared,
    };
  }
}

// re-export for tests that touch modules directly
export { Acl, Router, Shard, Coordinator };
