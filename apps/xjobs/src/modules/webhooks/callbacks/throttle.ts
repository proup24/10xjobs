const WINDOW_MS = 60_000;

/** In-memory sliding window per webhook id. */
export class CallbackThrottle {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly perMinute: number) {}

  /** Counts the request and returns true, or returns false (uncounted) when the window is full. */
  allow(webhookId: string, nowMs: number): boolean {
    const recent = (this.hits.get(webhookId) ?? []).filter(
      (t) => t > nowMs - WINDOW_MS,
    );
    if (recent.length >= this.perMinute) {
      this.hits.set(webhookId, recent);
      return false;
    }
    recent.push(nowMs);
    this.hits.set(webhookId, recent);
    return true;
  }
}
