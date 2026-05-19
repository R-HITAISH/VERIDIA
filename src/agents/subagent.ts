/**
 * Single entry point for any sub-agent invocation. The orchestrator decides
 * the kind ("market", "financial", etc.); we look up the sealed tool surface
 * and the role-specific system prompt.
 */

import { runAgent } from "../llm/index.js";
import { SUBAGENT_SYSTEMS, subAgentUser } from "../prompts/index.js";
import { toolsByAgent } from "../tools/index.js";
import { extractJson } from "./util.js";
import type { SubAgentKind } from "../queue/index.js";
import type { TraceContext } from "../omium.js";

export interface SubAgentInvocation {
  kind: SubAgentKind;
  company: string;
  ticker?: string;
  objective: string;
  hints?: Record<string, unknown>;
  ctx: TraceContext;
}

export async function runSubAgent(
  inv: SubAgentInvocation,
): Promise<Record<string, unknown>> {
  const system = SUBAGENT_SYSTEMS[inv.kind];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = toolsByAgent[inv.kind] as any;
  const out = await runAgent("openai", {
    system,
    user: subAgentUser(inv.kind, inv.company, inv.ticker, inv.objective, inv.hints),
    tools,
    tier: "deep",
    maxSteps: 5,
    ctx: inv.ctx,
    agentName: `subagent.${inv.kind}`,
  });
  try {
    return extractJson<Record<string, unknown>>(out.finalText);
  } catch (err) {
    // Don't crash the whole run — return a structured failure that synthesis
    // can flag. This is the "independent failure" guarantee in the README.
    return {
      _error: err instanceof Error ? err.message : String(err),
      _rawTail: out.finalText.slice(-1000),
    };
  }
}
