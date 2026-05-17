/**
 * Sub-agent worker. Consumes veridia.subagent. Runs one specialised agent
 * (market / financial / tech / team / risk) and writes its structured result
 * back to the run state.
 */

import { Worker, Job } from "bullmq";
import { connection } from "../queue/index.js";
import { runSubAgent } from "../agents/subagent.js";
import {
  saveAgentResult,
  appendEvent,
  getRun,
  type RunTrigger,
} from "../state/store.js";
import { withSpan } from "../omium.js";
import { logger } from "../logger.js";
import type { SubAgentJob } from "../queue/index.js";

export function startSubAgentWorker(): Worker<SubAgentJob> {
  const worker = new Worker<SubAgentJob>(
    "veridia.subagent",
    async (job: Job<SubAgentJob>) => {
      const { runId, kind, objective, hints, parentSpanId } = job.data;
      const ctx = { runId, parentId: parentSpanId };

      return withSpan(
        ctx,
        "agent",
        `subagent.${kind}`,
        { kind, objective, hints },
        async (childCtx) => {
          const run = await getRun(runId);
          if (!run) throw new Error(`Run ${runId} not found`);
          const trigger = run.trigger as RunTrigger;

          const result = await runSubAgent({
            kind,
            company: trigger.company,
            ticker: trigger.ticker,
            objective,
            hints,
            ctx: childCtx,
          });

          // Key by kind. If the planner dispatched multiple of the same kind,
          // later ones overwrite — synthesis still sees one consolidated entry
          // per agent type, which is the contract.
          await saveAgentResult(runId, kind, result);
          await appendEvent(runId, {
            ts: Date.now(),
            kind: "agent.done",
            message: `Sub-agent ${kind} returned`,
            data: { kind, hasError: "_error" in result },
          });
          return result;
        },
      );
    },
    { connection, concurrency: 6 },
  );
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err, kind: job?.data.kind }, "subagent failed");
    if (job) {
      appendEvent(job.data.runId, {
        ts: Date.now(),
        kind: "agent.error",
        message: `Sub-agent ${job.data.kind} failed: ${err.message}`,
      }).catch(() => {});
    }
  });
  return worker;
}
