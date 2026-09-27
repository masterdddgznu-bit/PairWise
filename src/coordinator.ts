import type { TxStatus, WriteOp } from "./types.js";

/** In-memory tx records — stub. */
export class CoordinatorState {
  begin(_txId: string): void {
    /* stub */
  }

  status(_txId: string): TxStatus | undefined {
    return undefined;
  }

  setStatus(_txId: string, _s: TxStatus): void {
    /* stub */
  }

  addWrite(_txId: string, _op: WriteOp): void {
    /* stub */
  }

  writes(_txId: string): WriteOp[] {
    return [];
  }

  clear(): void {
    /* stub */
  }

  setParticipants(_txId: string, _ids: number[]): void {
    /* stub */
  }

  participants(_txId: string): number[] {
    return [];
  }

  knownIds(): string[] {
    return [];
  }
}
