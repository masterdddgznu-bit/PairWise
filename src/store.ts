import { VirtualClock } from "./clock.js";
import {
  DuplicatePinError,
  DuplicateTxnError,
  InvalidConfigError,
  UnknownPinError,
  UnknownTxnError,
} from "./errors.js";
import { collect } from "./gc.js";
import { PinBook } from "./pins.js";
import { TxnBook } from "./txns.js";
import type { EpochMVCCOptions } from "./types.js";
import { VersionStore } from "./versions.js";

export class EpochMVCC {
  readonly clock: VirtualClock;
  private readonly pinTtlMs: number | null;
  private readonly versions = new VersionStore();
  private readonly pins = new PinBook();
  private readonly txns = new TxnBook();
  private currentEpoch = 0;

  constructor(opts: EpochMVCCOptions) {
    if (!opts || !(opts.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("clock must be a VirtualClock");
    }
    const ttl = opts.pinTtlMs ?? null;
    if (ttl !== null && (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl < 1)) {
      throw new InvalidConfigError("pinTtlMs must be null or a number >= 1");
    }
    this.clock = opts.clock;
    this.pinTtlMs = ttl;
  }

  epoch(): number {
    return this.currentEpoch;
  }

  get(key: string): string | undefined {
    return this.getAt(this.currentEpoch, key);
  }

  getAt(epoch: number, key: string): string | undefined {
    return this.versions.getAt(key, epoch);
  }

  pin(pinId: string): number {
    if (this.pins.has(pinId)) throw new DuplicatePinError(`duplicate pin: ${pinId}`);
    const epoch = this.currentEpoch;
    const deadline = this.pinTtlMs === null ? null : this.clock.now() + this.pinTtlMs;
    this.pins.pin(pinId, epoch, deadline);
    return epoch;
  }

  unpin(pinId: string): boolean {
    return this.pins.unpin(pinId);
  }

  getPinned(pinId: string, key: string): string | undefined {
    return this.versions.getAt(key, this.pins.epochOf(pinId));
  }

  pinEpoch(pinId: string): number {
    return this.pins.epochOf(pinId);
  }

  pinnedIds(): string[] {
    return this.pins.ids();
  }

  begin(txnId: string): void {
    if (this.txns.has(txnId)) throw new DuplicateTxnError(`duplicate txn: ${txnId}`);
    this.txns.begin(txnId, this.currentEpoch);
  }

  write(txnId: string, key: string, value: string): void {
    this.requireTxn(txnId).writes.set(key, { kind: "put", value });
  }

  delete(txnId: string, key: string): void {
    this.requireTxn(txnId).writes.set(key, { kind: "del" });
  }

  read(txnId: string, key: string): string | undefined {
    const txn = this.requireTxn(txnId);
    const op = txn.writes.get(key);
    if (op) return op.kind === "put" ? op.value : undefined;
    return this.versions.getAt(key, txn.readEpoch);
  }

  commit(txnId: string): "ok" | "conflict" {
    const txn = this.txns.take(txnId);
    if (!txn) throw new UnknownTxnError(`unknown txn: ${txnId}`);
    if (txn.writes.size === 0) return "ok";
    for (const key of txn.writes.keys()) {
      if (this.versions.latestEpoch(key) > txn.readEpoch) return "conflict";
    }
    this.currentEpoch += 1;
    for (const [key, op] of txn.writes) {
      this.versions.append(key, this.currentEpoch, op.kind === "put" ? op.value : null);
    }
    return "ok";
  }

  abort(txnId: string): boolean {
    return this.txns.abort(txnId);
  }

  gc(): number {
    return collect(this.versions, this.pins);
  }

  drive(): string[] {
    const expired = this.pins.expired(this.clock.now());
    for (const id of expired) this.pins.unpin(id);
    return expired;
  }

  versionCount(key: string): number {
    return this.versions.count(key);
  }

  hasTxn(txnId: string): boolean {
    return this.txns.has(txnId);
  }

  private requireTxn(txnId: string) {
    const txn = this.txns.get(txnId);
    if (!txn) throw new UnknownTxnError(`unknown txn: ${txnId}`);
    return txn;
  }
}
