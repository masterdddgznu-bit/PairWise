import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  InvalidDeriveError,
  InvalidMintError,
  UnknownCapError,
} from "./errors.js";

interface Cap {
  id: number;
  holderId: string;
  prefix: string;
  ops: ReadonlySet<string>;
  parent: number | null;
  children: number[];
  deadline: number;
  revoked: boolean;
  expiryProcessed: boolean;
}

export interface CapChainOptions {
  clock: VirtualClock;
  ttlMs: number;
  maxChildren?: number;
}

function pathUnderPrefix(path: string, prefix: string): boolean {
  return (
    path === prefix ||
    (prefix === "/" && path.startsWith("/")) ||
    path.startsWith(prefix + "/")
  );
}

function normalizeOps(ops: string[]): string[] | null {
  const unique = [...new Set(ops)];
  if (unique.length === 0 || unique.some((op) => op.length === 0)) {
    return null;
  }
  return unique;
}

export class CapChain {
  private readonly clock: VirtualClock;
  private readonly ttlMs: number;
  private readonly maxChildren: number;
  private readonly caps = new Map<number, Cap>();
  private nextId = 1;

  constructor(options: CapChainOptions) {
    const { clock, ttlMs, maxChildren = 8 } = options;
    if (!Number.isFinite(ttlMs) || ttlMs < 1) {
      throw new InvalidConfigError("ttlMs must be >= 1");
    }
    if (!Number.isFinite(maxChildren) || maxChildren < 1) {
      throw new InvalidConfigError("maxChildren must be >= 1");
    }
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.maxChildren = maxChildren;
  }

  mint(holderId: string, prefix: string, ops: string[]): number {
    const uniqueOps = normalizeOps(ops);
    if (holderId.length === 0 || prefix.length === 0 || uniqueOps === null) {
      throw new InvalidMintError("invalid mint arguments");
    }
    return this.createCap(holderId, prefix, uniqueOps, null);
  }

  derive(
    holderId: string,
    parentId: number,
    prefix: string,
    ops: string[],
  ): number {
    const parent = this.caps.get(parentId);
    if (parent === undefined) {
      throw new UnknownCapError(`unknown capability ${parentId}`);
    }
    if (holderId !== parent.holderId) {
      throw new InvalidDeriveError("holder does not match parent holder");
    }
    if (parent.revoked || this.isExpired(parent)) {
      throw new InvalidDeriveError("parent is revoked or expired");
    }
    const uniqueOps = normalizeOps(ops);
    if (
      prefix.length === 0 ||
      !pathUnderPrefix(prefix, parent.prefix) ||
      uniqueOps === null ||
      uniqueOps.some((op) => !parent.ops.has(op))
    ) {
      throw new InvalidDeriveError("child must attenuate parent");
    }
    if (parent.children.length >= this.maxChildren) {
      throw new InvalidDeriveError("parent has too many children");
    }
    return this.createCap(holderId, prefix, uniqueOps, parentId);
  }

  check(capId: number, path: string, op: string): boolean {
    const cap = this.requireCap(capId);
    for (let cur: Cap | undefined = cap; cur !== undefined; ) {
      if (cur.revoked || this.isExpired(cur)) {
        return false;
      }
      cur = cur.parent === null ? undefined : this.caps.get(cur.parent);
    }
    return pathUnderPrefix(path, cap.prefix) && cap.ops.has(op);
  }

  heartbeat(holderId: string, capId: number): boolean {
    const cap = this.requireCap(capId);
    if (cap.holderId !== holderId || cap.revoked || this.isExpired(cap)) {
      return false;
    }
    cap.deadline = this.clock.now() + this.ttlMs;
    return true;
  }

  revoke(holderId: string, capId: number): boolean {
    const cap = this.requireCap(capId);
    if (cap.holderId !== holderId || cap.revoked) {
      return false;
    }
    const stack = [cap];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      cur.revoked = true;
      for (const childId of cur.children) {
        stack.push(this.caps.get(childId)!);
      }
    }
    return true;
  }

  drive(): { expired: number[] } {
    const expired: number[] = [];
    for (const cap of this.caps.values()) {
      if (!cap.expiryProcessed && this.isExpired(cap)) {
        cap.expiryProcessed = true;
        expired.push(cap.id);
      }
    }
    expired.sort((a, b) => a - b);
    return { expired };
  }

  holderOf(capId: number): string {
    return this.requireCap(capId).holderId;
  }

  prefixOf(capId: number): string {
    return this.requireCap(capId).prefix;
  }

  opsOf(capId: number): string[] {
    return [...this.requireCap(capId).ops].sort();
  }

  parentOf(capId: number): number | null {
    return this.requireCap(capId).parent;
  }

  childrenOf(capId: number): number[] {
    return [...this.requireCap(capId).children].sort((a, b) => a - b);
  }

  private createCap(
    holderId: string,
    prefix: string,
    ops: string[],
    parent: number | null,
  ): number {
    const id = this.nextId++;
    this.caps.set(id, {
      id,
      holderId,
      prefix,
      ops: new Set(ops),
      parent,
      children: [],
      deadline: this.clock.now() + this.ttlMs,
      revoked: false,
      expiryProcessed: false,
    });
    if (parent !== null) {
      this.caps.get(parent)!.children.push(id);
    }
    return id;
  }

  private requireCap(capId: number): Cap {
    const cap = this.caps.get(capId);
    if (cap === undefined) {
      throw new UnknownCapError(`unknown capability ${capId}`);
    }
    return cap;
  }

  private isExpired(cap: Cap): boolean {
    return this.clock.now() >= cap.deadline;
  }
}
