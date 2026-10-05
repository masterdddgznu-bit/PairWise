export class CapChainError extends Error {}
export class InvalidConfigError extends CapChainError {}
export class InvalidMintError extends CapChainError {}
export class InvalidDeriveError extends CapChainError {}
export class UnknownCapError extends CapChainError {}
export class InvalidRevokeError extends CapChainError {}

export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new CapChainError("cannot advance clock by a negative amount");
    }
    this.t += ms;
  }
}

export interface CapChainConfig {
  clock: VirtualClock;
  ttlMs: number;
  maxChildren?: number;
}

interface Cap {
  id: number;
  holderId: string;
  prefix: string;
  ops: Set<string>;
  parentId: number | null;
  children: number[];
  deadline: number;
  revoked: boolean;
  expiryProcessed: boolean;
}

function pathUnder(path: string, prefix: string): boolean {
  if (path === prefix) return true;
  if (prefix === "/" && path.startsWith("/")) return true;
  return path.startsWith(prefix + "/");
}

export class CapChain {
  private readonly clock: VirtualClock;
  private readonly ttlMs: number;
  private readonly maxChildren: number;
  private readonly caps = new Map<number, Cap>();
  private nextId = 1;

  constructor(config: CapChainConfig) {
    const { clock, ttlMs } = config;
    const maxChildren = config.maxChildren ?? 8;
    if (!Number.isFinite(ttlMs) || ttlMs < 1) {
      throw new InvalidConfigError("ttlMs must be >= 1");
    }
    if (!Number.isInteger(maxChildren) || maxChildren < 1) {
      throw new InvalidConfigError("maxChildren must be an integer >= 1");
    }
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.maxChildren = maxChildren;
  }

  mint(holderId: string, prefix: string, ops: string[]): number {
    const uniqueOps = this.validateMint(holderId, prefix, ops);
    return this.createCap(holderId, prefix, uniqueOps, null);
  }

  derive(holderId: string, parentId: number, prefix: string, ops: string[]): number {
    const parent = this.caps.get(parentId);
    if (!parent) {
      throw new UnknownCapError(`unknown cap ${parentId}`);
    }
    if (holderId !== parent.holderId) {
      throw new InvalidDeriveError("holder does not match parent holder");
    }
    if (parent.revoked || this.clock.now() >= parent.deadline) {
      throw new InvalidDeriveError("parent is revoked or expired");
    }
    if (typeof prefix !== "string" || prefix.length === 0 || !pathUnder(prefix, parent.prefix)) {
      throw new InvalidDeriveError("child prefix must fall under parent prefix");
    }
    const uniqueOps = [...new Set(ops)];
    if (
      uniqueOps.length === 0 ||
      uniqueOps.some((op) => typeof op !== "string" || op.length === 0 || !parent.ops.has(op))
    ) {
      throw new InvalidDeriveError("child ops must be a non-empty subset of parent ops");
    }
    if (parent.children.length >= this.maxChildren) {
      throw new InvalidDeriveError("parent already has maxChildren direct children");
    }
    const id = this.createCap(holderId, prefix, uniqueOps, parentId);
    parent.children.push(id);
    return id;
  }

  check(capId: number, path: string, op: string): boolean {
    const cap = this.mustGet(capId);
    if (!this.isLive(cap)) return false;
    if (!pathUnder(path, cap.prefix)) return false;
    return cap.ops.has(op);
  }

  heartbeat(holderId: string, capId: number): boolean {
    const cap = this.mustGet(capId);
    if (cap.holderId !== holderId) return false;
    if (cap.revoked || this.clock.now() >= cap.deadline) return false;
    cap.deadline = this.clock.now() + this.ttlMs;
    return true;
  }

  revoke(holderId: string, capId: number): boolean {
    const cap = this.mustGet(capId);
    if (cap.holderId !== holderId) return false;
    if (cap.revoked) return false;
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
    const now = this.clock.now();
    const expired: number[] = [];
    for (const cap of this.caps.values()) {
      if (!cap.expiryProcessed && now >= cap.deadline) {
        cap.expiryProcessed = true;
        expired.push(cap.id);
      }
    }
    expired.sort((a, b) => a - b);
    return { expired };
  }

  holderOf(capId: number): string {
    return this.mustGet(capId).holderId;
  }

  prefixOf(capId: number): string {
    return this.mustGet(capId).prefix;
  }

  opsOf(capId: number): string[] {
    return [...this.mustGet(capId).ops].sort();
  }

  parentOf(capId: number): number | null {
    return this.mustGet(capId).parentId;
  }

  childrenOf(capId: number): number[] {
    return [...this.mustGet(capId).children].sort((a, b) => a - b);
  }

  private validateMint(holderId: string, prefix: string, ops: string[]): string[] {
    if (typeof holderId !== "string" || holderId.length === 0) {
      throw new InvalidMintError("holderId must be a non-empty string");
    }
    if (typeof prefix !== "string" || prefix.length === 0) {
      throw new InvalidMintError("prefix must be a non-empty string");
    }
    const uniqueOps = [...new Set(ops)];
    if (
      uniqueOps.length === 0 ||
      uniqueOps.some((op) => typeof op !== "string" || op.length === 0)
    ) {
      throw new InvalidMintError("ops must contain at least one non-empty string");
    }
    return uniqueOps;
  }

  private createCap(
    holderId: string,
    prefix: string,
    ops: string[],
    parentId: number | null,
  ): number {
    const id = this.nextId++;
    this.caps.set(id, {
      id,
      holderId,
      prefix,
      ops: new Set(ops),
      parentId,
      children: [],
      deadline: this.clock.now() + this.ttlMs,
      revoked: false,
      expiryProcessed: false,
    });
    return id;
  }

  private mustGet(capId: number): Cap {
    const cap = this.caps.get(capId);
    if (!cap) {
      throw new UnknownCapError(`unknown cap ${capId}`);
    }
    return cap;
  }

  private isLive(cap: Cap): boolean {
    let cur: Cap | undefined = cap;
    const now = this.clock.now();
    while (cur) {
      if (cur.revoked || now >= cur.deadline) return false;
      cur = cur.parentId === null ? undefined : this.caps.get(cur.parentId);
    }
    return true;
  }
}
