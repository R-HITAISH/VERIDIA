/**
 * Report worker. Final stage: render PDF, deliver to Slack, mark run done.
 */

import { Worker, Job } from "bullmq";
import { connection } from "../queue/index.js";
import { generateMemoPdf } from "../report/generate.js";
import { postMemoToSlack } from "../tools/slack.js";
import {
  getRun,
  listAgentResults,
  setStatus,
  setReport,
  type RunTrigger,
} from "../state/store.js";
import { withSpan } from "../omium.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import type { ReportJob } from "../queue/index.js";
import type { SynthesisResult } from "../agents/synthesis.js";

export function startReportWorker(): Worker<ReportJob> {
  const worker = new Worker<ReportJob>(
    "veridia.report",
    async (job: Job<ReportJob>) => {
      const { runId, parentSpanId } = job.data;
      const ctx = { runId, parentId: parentSpanId };

      return withSpan(
        ctx,
        "report",
        "report.generate",
        { runId },
        async () => {
          await setStatus(runId, "reporting");
          const run = await getRun(runId);
          if (!run) throw new Error(`Run ${runId} not found`);
          const trigger = run.trigger as RunTrigger;
          const synthesis = run.synthesis as SynthesisResult;
          const agents = await listAgentResults(runId);

          const pdfPath = await generateMemoPdf({
            runId,
            trigger,
            synthesis,
            agents,
          });

          const publicUrl = `http://localhost:${config.PORT}/reports/${runId}.pdf`;
          const slackOk = await postMemoToSlack({
            runId,
            company: trigger.company,
            ticker: trigger.ticker,
            verdict: synthesis.verdict,
            conviction: synthesis.conviction,
            headline: synthesis.headline,
            keyRisks: synthesis.keyRisks.slice(0, 5),
            reportUrl: publicUrl,
          });

          await setReport(runId, pdfPath, slackOk);
          await setStatus(runId, "done");
          return { pdfPath, slackOk };
        },
      );
    },
    { connection, concurrency: 2 },
  );
  worker.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, err }, "report failed"),
  );
  return worker;
}
