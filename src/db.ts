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
 * 门面 API。
 */

type TxState = "active" | "committed" | "aborted";

interface TxRecord {
  user: string;
  state: TxState;
  buffer: Map<string, string>;
  preparedShards: string[];
}

export class Db {
  private readonly shards: Record<string, Shard>;
  private readonly router: Router;
  private readonly acl: Acl;
  private readonly coordinator: Coordinator;
  private readonly txs = new Map<number, TxRecord>();
  private nextTx = 1;
  private committedCount = 0;
  private abortedCount = 0;

  constructor(opts: DbOptions) {
    this.shards = opts.shards;
    this.router = new Router(opts.routing);
    this.acl = new Acl(opts.acl);
    this.coordinator = new Coordinator(opts.shards);
  }

  begin(user: string): number {
    const tx = this.nextTx++;
    this.txs.set(tx, {
      user,
      state: "active",
      buffer: new Map(),
      preparedShards: [],
    });
    return tx;
  }

  get(tx: number, key: string): string | undefined {
    const record = this.activeTx(tx);
    if (!this.acl.check(record.user, "read", key)) {
      throw new Error(`read denied for user ${record.user} on key ${key}`);
    }
    if (record.buffer.has(key)) {
      return record.buffer.get(key);
    }
    return this.shardFor(key).get(key);
  }

  put(tx: number, key: string, value: string): void {
    const record = this.activeTx(tx);
    if (!this.acl.check(record.user, "write", key)) {
      throw new Error(`write denied for user ${record.user} on key ${key}`);
    }
    record.buffer.set(key, value);
  }

  commit(tx: number): void {
    const record = this.activeTx(tx);
    const writeSet: Record<string, Record<string, string>> = {};
    for (const [key, value] of record.buffer) {
      const shardId = this.router.shardOf(key);
      (writeSet[shardId] ??= {})[key] = value;
    }
    const result = this.coordinator.commit(tx, writeSet);
    if (result === "aborted") {
      record.state = "aborted";
      record.buffer.clear();
      this.abortedCount++;
      throw new Error(`commit aborted for tx ${tx}`);
    }
    record.state = "committed";
    record.buffer.clear();
    this.committedCount++;
  }

  abort(tx: number): void {
    const record = this.activeTx(tx);
    if (record.preparedShards.length > 0) {
      this.coordinator.abortPrepared(tx, record.preparedShards);
      record.preparedShards = [];
    }
    record.buffer.clear();
    record.state = "aborted";
    this.abortedCount++;
  }

  stats(): DbStats {
    let active = 0;
    for (const record of this.txs.values()) {
      if (record.state === "active") {
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

  private activeTx(tx: number): TxRecord {
    const record = this.txs.get(tx);
    if (record === undefined || record.state !== "active") {
      throw new Error(`tx ${tx} is not active`);
    }
    return record;
  }

  private shardFor(key: string): Shard {
    const shard = this.shards[this.router.shardOf(key)];
    if (shard === undefined) {
      throw new Error(`unknown shard for key: ${key}`);
    }
    return shard;
  }
}

// re-export for tests that touch modules directly
export { Acl, Router, Shard, Coordinator };
