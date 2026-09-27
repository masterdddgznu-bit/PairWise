import { VirtualClock } from "./clock.js";
import { EventLog } from "./events.js";
import { GrantStore } from "./grants.js";
import { RoleGraph } from "./roles.js";
import { applyTxn } from "./txn.js";
import { TtlIndex } from "./ttl.js";
import type { AuthzEvent, Grant, GrantOpts, TxnOp } from "./types.js";

/**
 * Authorization policy engine.
 * Supports role inheritance, resource wildcards, TTL grants, explicit deny,
 * event watch/compact and atomic transactions.
 */
export class AuthzPolicy {
  readonly clock: VirtualClock;
  /** @internal */ readonly roles: RoleGraph;
  /** @internal */ readonly store: GrantStore;
  /** @internal */ readonly ttl: TtlIndex;
  /** @internal */ readonly events: EventLog;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.roles = new RoleGraph();
    this.store = new GrantStore();
    this.ttl = new TtlIndex();
    this.events = new EventLog();
  }

  grant(subject: string, role: string, resource: string, opts?: GrantOpts): void {
    const effect = opts?.effect ?? "allow";
    const now = this.clock.now();
    const expireAt = opts?.ttlMs === undefined ? null : now + opts.ttlMs;
    const key = GrantStore.keyOf(subject, role, resource);
    this.ttl.clear(key);
    const g: Grant = {
      subject,
      role,
      resource,
      effect,
      expireAt,
    };
    this.store.put(g);
    if (expireAt !== null) this.ttl.set(key, expireAt);
    this.events.append("grant", subject, role, resource, now);
  }

  revoke(subject: string, role: string, resource: string): boolean {
    const key = GrantStore.keyOf(subject, role, resource);
    const ok = this.store.removeByKey(key);
    this.ttl.clear(key);
    if (ok) {
      this.events.append("revoke", subject, role, resource, this.clock.now());
    }
    return ok;
  }

  check(subject: string, role: string, resource: string): boolean {
    const roles = new Set(this.roles.expand(role));
    const winner = this.store.bestMatch(subject, roles, resource, this.clock.now());
    return winner !== undefined && winner.effect === "allow";
  }

  grants(subject: string): Grant[] {
    return this.store.listBySubject(subject, this.clock.now());
  }

  addRoleParent(child: string, parent: string): void {
    this.roles.addParent(child, parent);
  }

  tick(): void {
    const now = this.clock.now();
    for (const key of this.ttl.expired(now)) {
      const g = this.store.getByKey(key);
      this.store.removeByKey(key);
      this.ttl.clear(key);
      if (g) this.events.append("expire", g.subject, g.role, g.resource, now);
    }
  }

  txn(ops: TxnOp[]): void {
    applyTxn(this, ops);
  }

  currentSeq(): number {
    return this.events.currentSeq();
  }

  watch(fromSeq: number): string {
    return this.events.watch(fromSeq);
  }

  pollWatch(watchId: string): AuthzEvent[] {
    return this.events.pollWatch(watchId);
  }

  unwatch(watchId: string): void {
    this.events.unwatch(watchId);
  }

  compact(beforeSeq: number): void {
    this.events.compact(beforeSeq);
  }

  /** @internal */
  snapshot(): PolicySnapshot {
    return {
      store: this.store.snapshot(),
      ttl: this.ttl.snapshot(),
      roles: this.roles.snapshot(),
      events: this.events.snapshot(),
    };
  }

  /** @internal */
  restore(snapshot: PolicySnapshot): void {
    this.store.restore(snapshot.store);
    this.ttl.restore(snapshot.ttl);
    this.roles.restore(snapshot.roles);
    this.events.restore(snapshot.events);
  }
}

type PolicySnapshot = {
  store: ReturnType<GrantStore["snapshot"]>;
  ttl: ReturnType<TtlIndex["snapshot"]>;
  roles: ReturnType<RoleGraph["snapshot"]>;
  events: ReturnType<EventLog["snapshot"]>;
};
