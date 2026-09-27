import type { TxStatus, WriteOp } from "./types.js";

export type TxRecord = {
  status: TxStatus;
  writes: WriteOp[];
  participants: number[];
};

/** In-memory transaction records kept by the coordinator. */
export class CoordinatorState {
  private readonly txs = new Map<string, TxRecord>();

  begin(txId: string): void {
    this.txs.set(txId, { status: "open", writes: [], participants: [] });
  }

  status(txId: string): TxStatus | undefined {
    return this.txs.get(txId)?.status;
  }

  setStatus(txId: string, s: TxStatus): void {
    this.txs.get(txId)!.status = s;
  }

  addWrite(txId: string, op: WriteOp): void {
    const record = this.txs.get(txId)!;
    const existing = record.writes.find(
      (w) => w.participantId === op.participantId && w.key === op.key,
    );
    if (existing) {
      existing.value = op.value;
    } else {
      record.writes.push(op);
    }
  }

  writes(txId: string): WriteOp[] {
    return this.txs.get(txId)?.writes ?? [];
  }

  clear(): void {
    this.txs.clear();
  }

  setParticipants(txId: string, ids: number[]): void {
    this.txs.get(txId)!.participants = [...ids];
  }

  participants(txId: string): number[] {
    return this.txs.get(txId)?.participants ?? [];
  }

  knownIds(): string[] {
    return [...this.txs.keys()];
  }

  /** Insert a reconstructed record (used during recovery). */
  restore(txId: string, status: TxStatus, participants: number[]): void {
    this.txs.set(txId, { status, writes: [], participants: [...participants] });
  }
}
