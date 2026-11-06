// Fixed-size sliding-window counters (in memory; one process).
export class SlidingWindow {
  #hits = new Map<string, number[]>();
  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Records a hit and returns true if it is within the limit. */
  hit(key: string, now: number): boolean {
    const from = now - this.windowMs;
    let arr = this.#hits.get(key);
    if (!arr) this.#hits.set(key, (arr = []));
    while (arr.length && arr[0]! <= from) arr.shift();
    if (arr.length >= this.limit) return false;
    arr.push(now);
    return true;
  }

  /** Drop idle keys (call periodically). */
  sweep(now: number): void {
    for (const [k, arr] of this.#hits) if (!arr.length || arr[arr.length - 1]! <= now - this.windowMs) this.#hits.delete(k);
  }
}
