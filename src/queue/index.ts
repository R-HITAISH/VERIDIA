/**
 * BullMQ queue definitions. One queue per agent role keeps concurrency,
 * retries, and observability cleanly separated.
 *
 *   orchestrator  ─► subagent.*  ─► synthesis ─► report
 */

import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config.js";

export const connection: ConnectionOptions = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export type SubAgentKind =
  | "market"
  | "financial"
  | "tech"
  | "team"
  | "risk";

export interface OrchestratorJob {
  runId: string;
  /** When true, this is a *re-plan* triggered by synthesis asking for more evidence. */
  replan?: boolean;
}

export interface SubAgentJob {
  runId: string;
  kind: SubAgentKind;
  /** Free-form objective injected into the sub-agent's prompt. */
  objective: string;
  /** Targeted hints from the planner (e.g. tickers, repo URLs). */
  hints?: Record<string, unknown>;
  /** Parent Omium span id, so children link back. */
  parentSpanId: string | null;
}

export interface SynthesisJob {
  runId: string;
  parentSpanId: string | null;
}

export interface ReportJob {
  runId: string;
  parentSpanId: string | null;
}

export const queues = {
  orchestrator: new Queue<OrchestratorJob>("veridia.orchestrator", {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    },
  }),
  subagent: new Queue<SubAgentJob>("veridia.subagent", {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    },
  }),
  synthesis: new Queue<SynthesisJob>("veridia.synthesis", {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    },
  }),
  report: new Queue<ReportJob>("veridia.report", {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    },
  }),
};

export type Queues = typeof queues;
