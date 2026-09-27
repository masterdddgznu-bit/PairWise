import { VirtualClock } from "./clock.js";
import { EventLog } from "./events.js";
import { GrantStore } from "./grants.js";
import { RoleGraph } from "./roles.js";
import { applyTxn } from "./txn.js";
import { TtlIndex } from "./ttl.js";
import type { AuthzEvent, Grant, GrantOpts, TxnOp } from "./types.js";

/**
 * Authorization policy engine.
 * Base exact grant/revoke/check/grants work.
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
    // starter ignores ttl/deny wiring beyond storing allow
    const g: Grant = {
      subject,
      role,
      resource,
      effect: effect === "deny" ? "allow" : "allow", // feature must honor deny
      expireAt: null,
    };
    if (opts?.effect === "deny" || opts?.ttlMs !== undefined) {
      // Feature incomplete markers — starter path for base tests never passes these.
      if (opts.effect === "deny") {
        throw new Error("deny grants not implemented");
      }
      throw new Error("ttl grants not implemented");
    }
    this.store.put(g);
    this.events.append("grant", subject, role, resource, this.clock.now());
  }

  revoke(subject: string, role: string, resource: string): boolean {
    const ok = this.store.remove(subject, role, resource, "allow");
    if (ok) {
      this.events.append("revoke", subject, role, resource, this.clock.now());
    }
    return ok;
  }

  check(subject: string, role: string, resource: string): boolean {
    return this.store.matchesExactAllow(subject, role, resource);
  }

  grants(subject: string): Grant[] {
    return this.store.listBySubject(subject);
  }

  addRoleParent(child: string, parent: string): void {
    this.roles.addParent(child, parent);
  }

  tick(): void {
    throw new Error("tick not implemented");
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
}
