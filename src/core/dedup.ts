export class MessageDeduplicator {
  private seen = new Map<string, number>();
  private ttlMs: number;

  constructor(ttlMs: number = 600_000) {
    this.ttlMs = ttlMs;
  }

  isDuplicate(messageId: string): boolean {
    const now = Date.now();
    if (this.seen.has(messageId)) return true;
    this.seen.set(messageId, now);
    this.evict(now);
    return false;
  }

  private evict(now: number): void {
    for (const [id, ts] of this.seen) {
      if (now - ts > this.ttlMs) {
        this.seen.delete(id);
      } else {
        break;
      }
    }
  }
}
