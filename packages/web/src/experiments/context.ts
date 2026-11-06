import type { ClientTiming, NetworkDef, Variant } from "@anonscope/shared";
import type { WorkerHandle } from "../harness/createWorker";
import type { Pacer } from "../harness/pacer";
import type { Deadline } from "./budget";

export interface ExperimentContext {
  handle: WorkerHandle;
  network: NetworkDef;
  runId: string;
  observer: string;
  pacer: Pacer;
  log: (msg: string) => void;
  record: (t: ClientTiming) => void;
  /** Whole-run deadline; experiments stop at their next check once it passes. */
  deadline: Deadline;
}

export function probeUrl(ctx: ExperimentContext, variant: Variant, wallet: string): string {
  return `${ctx.observer}/rpc/${ctx.network.probeChain}/${ctx.runId}/${ctx.network.id}/${variant}/${wallet}`;
}
