/**
 * Entry point: boots Fastify, starts all BullMQ workers in the same process.
 * For production you'd split workers across containers; for the hackathon
 * single-process keeps the demo bulletproof.
 */

import { buildApp } from "./server/app.js";
import { startOrchestratorWorker } from "./workers/orchestrator.worker.js";
import { startSubAgentWorker } from "./workers/subagent.worker.js";
import { startSynthesisWorker } from "./workers/synthesis.worker.js";
import { startReportWorker } from "./workers/report.worker.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { omium } from "./omium.js";

async function main(): Promise<void> {
  const app = await buildApp();

  const workers = [
    startOrchestratorWorker(),
    startSubAgentWorker(),
    startSynthesisWorker(),
    startReportWorker(),
  ];

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  logger.info(
    {
      port: config.PORT,
      omium: omium.enabled,
      workers: workers.length,
    },
    "veridia online",
  );

  const shutdown = async (sig: string) => {
    logger.warn({ sig }, "shutting down");
    await app.close();
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "failed to boot");
  process.exit(1);
});
