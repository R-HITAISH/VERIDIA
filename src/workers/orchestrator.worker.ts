/**
 * Orchestrator worker. Consumes veridia.orchestrator jobs.
 *
 * Flow:
 *   1. Load run trigger from Redis.
 *   2. Set status=planning, call planner (Claude Sonnet).
 *   3. For each planned task, enqueue veridia.subagent job.
 *   4. Track completion: once all sub-agents settle, enqueue synthesis job.
 *
 * Crash-safety: if this worker dies mid-fan-out, BullMQ retries the
 * orchestrator job. Already-enqueued sub-agent jobs survive in Redis.
 * Re-running is idempotent because sub-agent results overwrite by key.
 */

import { Worker, Job, QueueEvents } from "bullmq";
import { connection, queues } from "../queue/index.js";
import {
  planInvestigation,
  replanInvestigation,
} from "../agents/orchestrator.js";
import {
  setStatus,
  setPlan,
  getRun,
  appendEvent,
  type RunTrigger,
} from "../state/store.js";
import { withSpan, rootCtx } from "../omium.js";
import { logger } from "../logger.js";
import type { OrchestratorJob, SubAgentJob } from "../queue/index.js";

const subagentEvents = new QueueEvents("veridia.subagent", { connection });

/** Wait for a specific batch of sub-agent jobIds to all settle (complete OR fail). */
async function waitForJobs(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const pending = new Set(jobIds);
  await new Promise<void>((resolve) => {
    const onSettle = ({ jobId }: { jobId: string }) => {
      if (pending.delete(jobId) && pending.size === 0) {
        subagentEvents.off("completed", onSettle);
        subagentEvents.off("failed", onSettle);
        resolve();
      }
    };
    subagentEvents.on("completed", onSettle);
    subagentEvents.on("failed", onSettle);
  });
}

async function dispatchTasks(
  runId: string,
  tasks: Array<{ kind: SubAgentJob["kind"]; objective: string; hints?: Record<string, unknown> }>,
  parentSpanId: string | null,
): Promise<string[]> {
  const ids: string[] = [];
  for (const t of tasks) {
    const job = await queues.subagent.add(
      `${runId}.${t.kind}.${Date.now()}`,
      {
        runId,
        kind: t.kind,
        objective: t.objective,
        hints: t.hints,
        parentSpanId,
      },
      { jobId: `${runId}.${t.kind}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}` },
    );
    ids.push(job.id!);
    await appendEvent(runId, {
      ts: Date.now(),
      kind: "agent.start",
      message: `Dispatched sub-agent: ${t.kind}`,
      data: { objective: t.objective },
    });
  }
  return ids;
}

export function startOrchestratorWorker(): Worker<OrchestratorJob> {
  const worker = new Worker<OrchestratorJob>(
    "veridia.orchestrator",
    async (job: Job<OrchestratorJob>) => {
      const { runId, replan } = job.data;
      const ctx = rootCtx(runId);

      return withSpan(
        ctx,
        "agent",
        replan ? "orchestrator.replan" : "orchestrator",
        { runId, replan: !!replan },
        async (childCtx, span) => {
          const run = await getRun(runId);
          if (!run) throw new Error(`Run ${runId} not found`);
          const trigger = run.trigger as RunTrigger;

          await setStatus(runId, "planning");

          let plan;
          if (replan) {
            const synth = run.synthesis as
              | { openQuestions?: string[]; replanQuestions?: string[] }
              | undefined;
            const questions = [
              ...(synth?.replanQuestions ?? []),
              ...(synth?.openQuestions ?? []),
            ];
            plan = await replanInvestigation(
              trigger.company,
              trigger.ticker,
              questions,
              childCtx,
            );
          } else {
            plan = await planInvestigation(trigger, childCtx);
          }
          await setPlan(runId, plan);
          await setStatus(runId, "investigating");

          const ids = await dispatchTasks(runId, plan.tasks, span.id);
          logger.info({ runId, count: ids.length }, "orchestrator dispatched sub-agents");

          // Wait for the batch to settle, then queue synthesis.
          await waitForJobs(ids);

          await queues.synthesis.add(
            `${runId}.synth.${Date.now()}`,
            { runId, parentSpanId: span.id },
            { jobId: `${runId}.synth.${Date.now()}` },
          );
          return { dispatched: ids.length };
        },
      );
    },
    { connection, concurrency: 4 },
  );
  worker.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, err }, "orchestrator job failed"),
  );
  return worker;
}
