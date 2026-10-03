export class LockTable {
  tryLock(_participantId: string, _txnId: string, _keys: string[]): boolean {
    return false;
  }
  releaseTxn(_participantId: string, _txnId: string): void {}
  locksOf(_participantId: string): string[] {
    return [];
  }
}
