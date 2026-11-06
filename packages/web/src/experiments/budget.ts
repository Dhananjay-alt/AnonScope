// Time and failure budgets for a run, so one dead network can't use up the
// runner's whole time limit and lose the data of every other network.
//
// - E2 stops after E2_ABORT_AFTER failed calls if none has succeeded.
// - A network with 0 successful E2 calls skips E3 and E5 (it is down).
// - E3 stops after E3_DEAD_VARIANTS variants in a row with 0 ok, and then
//   skips E5. One zero variant is not enough: a keyed variant failing while a
//   later one works is the "isolation unsupported" finding.
// - A whole-run deadline: once passed, every experiment stops at its next
//   check and the run uploads what it has.

export const E2_ABORT_AFTER = 3;
export const E3_DEAD_VARIANTS = 2;

export class Deadline {
  constructor(
    readonly at: number | null,
    private readonly now: () => number = Date.now,
  ) {}

  static inSeconds(sec: number | undefined | null, now: () => number = Date.now): Deadline {
    return new Deadline(sec && sec > 0 ? now() + sec * 1000 : null, now);
  }

  get passed(): boolean {
    return this.at !== null && this.now() >= this.at;
  }
}

/** E2: give up once `E2_ABORT_AFTER` calls have failed and none succeeded. */
export function e2ShouldAbort(done: number, ok: number): boolean {
  return ok === 0 && done >= E2_ABORT_AFTER;
}

/** E3: give up on the network after `E3_DEAD_VARIANTS` all-failed variants in a row. */
export function e3NetworkDead(okPerVariant: number[]): boolean {
  if (okPerVariant.length < E3_DEAD_VARIANTS) return false;
  return okPerVariant.slice(-E3_DEAD_VARIANTS).every((ok) => ok === 0);
}
