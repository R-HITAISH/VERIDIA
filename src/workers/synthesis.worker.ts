/**
 * Synthesis worker. Runs once all sub-agents in the current wave settle.
 * Two outcomes:
 *   - needsReplan=true  → enqueue another orchestrator job (replan=true)
 *   - needsReplan=false → enqueue the report job
 */

import { Worker, Job } from "bullmq";
import { connection, queues } from "../queue/index.js";
import { runSynthesis } from "../agents/synthesis.js";
import {
  getRun,
  listAgentResults,
  setSynthesis,
  setStatus,
  appendEvent,
  type RunTrigger,
} from "../state/store.js";
import { withSpan } from "../omium.js";
import { logger } from "../logger.js";
import type { SynthesisJob } from "../queue/index.js";

const MAX_REPLANS = 1;

export function startSynthesisWorker(): Worker<SynthesisJob> {
  const worker = new Worker<SynthesisJob>(
    "veridia.synthesis",
    async (job: Job<SynthesisJob>) => {
      const { runId, parentSpanId } = job.data;
      const ctx = { runId, parentId: parentSpanId };

      return withSpan(
        ctx,
        "synthesis",
        "synthesis",
        { runId },
        async (childCtx) => {
          await setStatus(runId, "synthesizing");
          const run = await getRun(runId);
          if (!run) throw new Error(`Run ${runId} not found`);
          const trigger = run.trigger as RunTrigger;
          const replansSoFar = Number(run.replanCount ?? 0);

          const agents = await listAgentResults(runId);
          const synth = await runSynthesis({
            company: trigger.company,
            ticker: trigger.ticker,
            agents,
            ctx: childCtx,
          });
          await setSynthesis(runId, synth);

          if (synth.needsReplan && replansSoFar < MAX_REPLANS) {
            await appendEvent(runId, {
              ts: Date.now(),
              kind: "synthesis",
              message: `Synthesis requested re-plan (${synth.replanQuestions.length} questions)`,
            });
            // Bump replan counter and queue an orchestrator re-plan.
            const { getRedis } = await import("../state/store.js");
            await getRedis().hset(`veridia:run:${runId}`, {
              replanCount: String(replansSoFar + 1),
            });
            await queues.orchestrator.add(
              `${runId}.replan.${Date.now()}`,
              { runId, replan: true },
              { jobId: `${runId}.replan.${Date.now()}` },
            );
            return { replanned: true };
          }

          await queues.report.add(
            `${runId}.report.${Date.now()}`,
            { runId, parentSpanId: ctx.parentId },
            { jobId: `${runId}.report.${Date.now()}` },
          );
          return { replanned: false };
        },
      );
    },
    { connection, concurrency: 2 },
  );
  worker.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, err }, "synthesis failed"),
  );
  return worker;
}
