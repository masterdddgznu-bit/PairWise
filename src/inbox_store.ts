/** Consumer-side dedupe of applied messageIds. */
export class InboxStore {
  private seen = new Map<string, Set<string>>();

  has(consumerId: string, messageId: string): boolean {
    return this.seen.get(consumerId)?.has(messageId) ?? false;
  }

  mark(consumerId: string, messageId: string): void {
    const consumerSeen = this.seen.get(consumerId) ?? new Set<string>();
    consumerSeen.add(messageId);
    this.seen.set(consumerId, consumerSeen);
  }

  clear(): void {
    this.seen.clear();
  }
}
