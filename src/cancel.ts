/**
 * Cancel flag + which steps must stop accepting success.
 */
export class CancelScope {
  private flags = new Map<string, boolean>();

  request(runId: string): void {
    this.flags.set(runId, true);
  }

  isRequested(runId: string): boolean {
    return this.flags.get(runId) === true;
  }

  clear(runId: string): void {
    this.flags.delete(runId);
  }
}
