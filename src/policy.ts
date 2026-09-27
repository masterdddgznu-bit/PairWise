import { VirtualClock } from "./clock.js";
import { EventLog } from "./events.js";
import {
  GrantStore,
  grantKey,
  isValidResourcePattern,
  resourceMatches,
  specificity,
} from "./grants.js";
import { RoleGraph } from "./roles.js";
import { applyTxn } from "./txn.js";
import { TtlIndex } from "./ttl.js";
import type { AuthzEvent, Effect, Grant, GrantOpts, TxnOp } from "./types.js";

/**
 * In-process authorization policy engine: role inheritance, wildcard
 * resources, TTL grants, explicit deny, event watch, transactions, compaction.
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
    this.commitGrant(subject, role, resource, opts);
  }

  revoke(subject: string, role: string, resource: string): boolean {
    return this.commitRevoke(subject, role, resource);
  }

  check(subject: string, role: string, resource: string): boolean {
    let best: { specificity: number; effect: Effect } | null = null;
    for (const candidateRole of this.roles.expand(role)) {
      for (const grant of this.store.all()) {
        if (grant.subject !== subject || grant.role !== candidateRole) continue;
        if (grant.expireAt !== null && grant.expireAt <= this.clock.now()) continue;
        if (!resourceMatches(grant.resource, resource)) continue;
        const score = specificity(grant.resource);
        if (best === null || score > best.specificity) {
          best = { specificity: score, effect: grant.effect };
        } else if (score === best.specificity && grant.effect === "deny") {
          best.effect = "deny";
        }
      }
    }
    return best?.effect === "allow";
  }

  grants(subject: string): Grant[] {
    const now = this.clock.now();
    return this.store
      .listBySubject(subject)
      .filter((g) => g.expireAt === null || g.expireAt > now);
  }

  addRoleParent(child: string, parent: string): void {
    this.commitAddRoleParent(child, parent);
  }

  tick(): void {
    const now = this.clock.now();
    for (const key of this.ttl.due(now)) {
      const grant = this.store.getByKey(key);
      if (!grant) {
        this.ttl.clear(key);
        continue;
      }
      this.store.deleteKey(key);
      this.ttl.clear(key);
      this.events.append("expire", grant.subject, grant.role, grant.resource, now);
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
  commitGrant(
    subject: string,
    role: string,
    resource: string,
    opts?: GrantOpts,
  ): void {
    if (!isValidResourcePattern(resource)) {
      throw new Error(
        `Invalid resource pattern: '${resource}' ('*' is only allowed as the final segment)`,
      );
    }
    const effect: Effect = opts?.effect ?? "allow";
    const expireAt =
      opts?.ttlMs === undefined ? null : this.clock.now() + opts.ttlMs;
    const grant: Grant = { subject, role, resource, effect, expireAt };
    const key = grantKey(grant);
    this.store.put(grant);
    if (expireAt === null) {
      this.ttl.clear(key);
    } else {
      this.ttl.set(key, expireAt);
    }
    this.events.append("grant", subject, role, resource, this.clock.now());
  }

  /** @internal */
  commitRevoke(subject: string, role: string, resource: string): boolean {
    const key = grantKey({ subject, role, resource, effect: "allow" });
    const existing = this.store.getByKey(key);
    if (!existing) return false;
    if (existing.expireAt !== null && existing.expireAt <= this.clock.now()) {
      return false;
    }
    this.store.deleteKey(key);
    this.ttl.clear(key);
    this.events.append("revoke", subject, role, resource, this.clock.now());
    return true;
  }

  /** @internal */
  commitAddRoleParent(child: string, parent: string): void {
    this.roles.addParent(child, parent);
  }

  /** @internal */
  snapshotState(): PolicySnapshot {
    return {
      grants: this.store.snapshot(),
      ttl: this.ttl.snapshot(),
      roles: this.roles.snapshot(),
      events: this.events.snapshot(),
    };
  }

  /** @internal */
  restoreState(snapshot: PolicySnapshot): void {
    this.store.restore(snapshot.grants);
    this.ttl.restore(snapshot.ttl);
    this.roles.restore(snapshot.roles);
    this.events.restore(snapshot.events);
  }
}

/** @internal */
export type PolicySnapshot = {
  grants: ReturnType<GrantStore["snapshot"]>;
  ttl: ReturnType<TtlIndex["snapshot"]>;
  roles: ReturnType<RoleGraph["snapshot"]>;
  events: ReturnType<EventLog["snapshot"]>;
};
