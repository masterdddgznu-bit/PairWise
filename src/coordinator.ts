import type { TxStatus, WriteOp } from "./types.js";

/** In-memory tx records — stub. */
export class CoordinatorState {
  private statuses = new Map<string, TxStatus>();
  private writeBuf = new Map<string, WriteOp[]>();
  private involved = new Map<string, number[]>();

  begin(txId: string): void {
    this.statuses.set(txId, "open");
    this.writeBuf.set(txId, []);
  }

  status(txId: string): TxStatus | undefined {
    return this.statuses.get(txId);
  }

  setStatus(txId: string, s: TxStatus): void {
    this.statuses.set(txId, s);
  }

  addWrite(txId: string, op: WriteOp): void {
    const ops = this.writeBuf.get(txId);
    if (!ops) return;
    const existing = ops.find(
      (o) => o.participantId === op.participantId && o.key === op.key,
    );
    if (existing) existing.value = op.value;
    else ops.push(op);
  }

  writes(txId: string): WriteOp[] {
    return this.writeBuf.get(txId) ?? [];
  }

  clear(): void {
    this.statuses.clear();
    this.writeBuf.clear();
    this.involved.clear();
  }

  setParticipants(txId: string, ids: number[]): void {
    this.involved.set(txId, ids);
  }

  participants(txId: string): number[] {
    return this.involved.get(txId) ?? [];
  }

  knownIds(): string[] {
    return [...this.statuses.keys()];
  }
}
