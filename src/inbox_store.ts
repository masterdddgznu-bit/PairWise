/** Consumer-side dedupe of applied messageIds. */
export class InboxStore {
  private seen = new Set<string>();

  private key(_consumerId: string, messageId: string): string {
    return messageId;
  }

  has(consumerId: string, messageId: string): boolean {
    return this.seen.has(this.key(consumerId, messageId));
  }

  mark(consumerId: string, messageId: string): void {
    this.seen.add(this.key(consumerId, messageId));
  }

  clear(): void {
    this.seen.clear();
  }
}
