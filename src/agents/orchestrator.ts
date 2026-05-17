/**
 * Orchestrator agent — runs in the orchestrator BullMQ worker. Plans the
 * investigation, fans out sub-agent jobs, and (on re-plan) closes gaps.
 */

import { runAgent } from "../llm/index.js";
import {
  ORCHESTRATOR_SYSTEM,
  REPLAN_SYSTEM,
  orchestratorUser,
} from "../prompts/index.js";
import { extractJson } from "./util.js";
import type { TraceContext } from "../omium.js";
import type { RunTrigger } from "../state/store.js";
import type { SubAgentKind } from "../queue/index.js";

export interface PlannedTask {
  kind: SubAgentKind;
  objective: string;
  hints?: Record<string, unknown>;
}

export interface DiligencePlan {
  thesis: string;
  tasks: PlannedTask[];
}

export async function planInvestigation(
  trigger: RunTrigger,
  ctx: TraceContext,
): Promise<DiligencePlan> {
  const out = await runAgent("openai", {
    system: ORCHESTRATOR_SYSTEM,
    user: orchestratorUser(trigger),
    tools: [],
    tier: "deep",
    ctx,
    agentName: "orchestrator",
  });
  const parsed = extractJson<DiligencePlan>(out.finalText);
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error("Orchestrator produced an empty plan");
  }
  return parsed;
}

export async function replanInvestigation(
  company: string,
  ticker: string | undefined,
  openQuestions: string[],
  ctx: TraceContext,
): Promise<DiligencePlan> {
  const user = `Target: ${company}${ticker ? ` (${ticker})` : ""}

Open questions flagged by synthesis:
${openQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Produce a SURGICAL follow-up plan as strict JSON.`;
  const out = await runAgent("openai", {
    system: REPLAN_SYSTEM,
    user,
    tools: [],
    tier: "deep",
    ctx,
    agentName: "orchestrator.replan",
  });
  const parsed = extractJson<DiligencePlan>(out.finalText);
  if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
  return parsed;
}
