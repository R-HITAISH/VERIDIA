/**
 * Redis-backed run state store. Survives worker crashes. Single source of
 * truth for: trigger payload, plan, sub-agent outputs, synthesis verdict,
 * final report URL, status timeline.
 *
 * Key layout:
 *   veridia:run:<runId>            HASH    top-level run record
 *   veridia:run:<runId>:agent:<k>  HASH    one per sub-agent result
 *   veridia:run:<runId>:events     LIST    append-only event stream (for SSE)
 */

import IORedis, { type Redis } from "ioredis";
import { config } from "../config.js";

export type RunStatus =
  | "queued"
  | "planning"
  | "investigating"
  | "synthesizing"
  | "reporting"
  | "done"
  | "failed";

export interface RunTrigger {
  source: "manual" | "sec-edgar" | "news" | "demo";
  ticker?: string;
  company: string;
  thesis?: string;
  filingType?: string;
  filingUrl?: string;
  receivedAt: number;
}

export interface RunEvent {
  ts: number;
  kind:
    | "status"
    | "plan"
    | "agent.start"
    | "agent.done"
    | "agent.error"
    | "tool.call"
    | "synthesis"
    | "report";
  message: string;
  data?: unknown;
}

let _redis: Redis | null = null;
export function getRedis(): Redis {
  if (!_redis) {
    _redis = new IORedis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }
  return _redis;
}

const runKey = (id: string) => `veridia:run:${id}`;
const agentKey = (id: string, name: string) =>
  `veridia:run:${id}:agent:${name}`;
const eventsKey = (id: string) => `veridia:run:${id}:events`;

export async function createRun(
  runId: string,
  trigger: RunTrigger,
): Promise<void> {
  const r = getRedis();
  await r.hset(runKey(runId), {
    runId,
    status: "queued" satisfies RunStatus,
    trigger: JSON.stringify(trigger),
    createdAt: String(Date.now()),
  });
  await appendEvent(runId, {
    ts: Date.now(),
    kind: "status",
    message: `Run created from ${trigger.source} trigger for ${trigger.company}`,
    data: trigger,
  });
}

export async function setStatus(
  runId: string,
  status: RunStatus,
): Promise<void> {
  const r = getRedis();
  await r.hset(runKey(runId), { status, updatedAt: String(Date.now()) });
  await appendEvent(runId, {
    ts: Date.now(),
    kind: "status",
    message: `→ ${status}`,
  });
}

export async function setPlan(runId: string, plan: unknown): Promise<void> {
  const r = getRedis();
  await r.hset(runKey(runId), { plan: JSON.stringify(plan) });
  await appendEvent(runId, {
    ts: Date.now(),
    kind: "plan",
    message: "Planner produced investigation plan",
    data: plan,
  });
}

export async function saveAgentResult(
  runId: string,
  agentName: string,
  result: unknown,
): Promise<void> {
  const r = getRedis();
  await r.hset(agentKey(runId, agentName), {
    name: agentName,
    result: JSON.stringify(result),
    finishedAt: String(Date.now()),
  });
}

export async function getAgentResult<T = unknown>(
  runId: string,
  agentName: string,
): Promise<T | null> {
  const r = getRedis();
  const raw = await r.hget(agentKey(runId, agentName), "result");
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function listAgentResults(
  runId: string,
): Promise<Record<string, unknown>> {
  const r = getRedis();
  const keys = await r.keys(`veridia:run:${runId}:agent:*`);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const name = k.split(":").pop()!;
    const raw = await r.hget(k, "result");
    if (raw) out[name] = JSON.parse(raw);
  }
  return out;
}

export async function setSynthesis(
  runId: string,
  synth: unknown,
): Promise<void> {
  const r = getRedis();
  await r.hset(runKey(runId), { synthesis: JSON.stringify(synth) });
  await appendEvent(runId, {
    ts: Date.now(),
    kind: "synthesis",
    message: "Synthesis complete",
    data: synth,
  });
}

export async function setReport(
  runId: string,
  reportPath: string,
  slackOk: boolean,
): Promise<void> {
  const r = getRedis();
  await r.hset(runKey(runId), {
    reportPath,
    slackDelivered: slackOk ? "1" : "0",
    finishedAt: String(Date.now()),
  });
  await appendEvent(runId, {
    ts: Date.now(),
    kind: "report",
    message: `Memo ready: ${reportPath}`,
    data: { reportPath, slackDelivered: slackOk },
  });
}

export async function getRun(runId: string): Promise<Record<string, unknown> | null> {
  const r = getRedis();
  const raw = await r.hgetall(runKey(runId));
  if (!raw.runId) return null;
  const out: Record<string, unknown> = { ...raw };
  for (const k of ["trigger", "plan", "synthesis"]) {
    if (typeof out[k] === "string") {
      try {
        out[k] = JSON.parse(out[k] as string);
      } catch {
        /* leave as-is */
      }
    }
  }
  out.agents = await listAgentResults(runId);
  return out;
}

export async function appendEvent(
  runId: string,
  ev: RunEvent,
): Promise<void> {
  const r = getRedis();
  await r.rpush(eventsKey(runId), JSON.stringify(ev));
  await r.ltrim(eventsKey(runId), -500, -1);
}

export async function getEvents(
  runId: string,
  fromIndex = 0,
): Promise<RunEvent[]> {
  const r = getRedis();
  const raws = await r.lrange(eventsKey(runId), fromIndex, -1);
  return raws.map((s) => JSON.parse(s) as RunEvent);
}
