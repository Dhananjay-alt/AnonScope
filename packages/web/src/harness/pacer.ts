// Client-side request pacing so a run stays inside the observer's per-run
// limit (60/min) and the shared gateways' patience (plan §6.6).
export class Pacer {
  #sent: number[] = [];
  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Wait until n more requests fit in the window, then reserve them. */
  async take(n = 1): Promise<void> {
    if (n > this.limit) throw new Error(`cannot take ${n} > limit ${this.limit}`);
    for (;;) {
      const t = this.now();
      while (this.#sent.length && this.#sent[0]! <= t - this.windowMs) this.#sent.shift();
      if (this.#sent.length + n <= this.limit) {
        for (let i = 0; i < n; i++) this.#sent.push(t);
        return;
      }
      const waitFor = this.#sent[this.#sent.length + n - this.limit - 1]! + this.windowMs - t + 5;
      await this.sleep(Math.max(waitFor, 5));
    }
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
