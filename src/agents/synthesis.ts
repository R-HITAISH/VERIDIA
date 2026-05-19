/**
 * Synthesis agent — Claude Sonnet, deep reasoning, no tools. Reads all
 * sub-agent outputs and produces a structured verdict OR asks for a re-plan.
 */

import { runAgent } from "../llm/index.js";
import { SYNTHESIS_SYSTEM, synthesisUser } from "../prompts/index.js";
import { extractJson } from "./util.js";
import type { TraceContext } from "../omium.js";

export interface SynthesisResult {
  needsReplan: boolean;
  replanQuestions: string[];
  verdict: "Strong Buy" | "Buy" | "Hold" | "Pass" | "Avoid";
  conviction: number;
  headline: string;
  thesis: string;
  keyDrivers: string[];
  keyRisks: string[];
  contradictions: Array<{ between: string[]; note: string }>;
  openQuestions: string[];
  evidenceTable: Array<{ claim: string; source: string; agent: string }>;
}

function fallbackSynthesis(company: string, agents: Record<string, unknown>): SynthesisResult {
  const agentNames = Object.keys(agents);
  const hasError = agentNames.some((k) => "_error" in ((agents[k] as Record<string, unknown>) ?? {}));
  return {
    needsReplan: false,
    replanQuestions: [],
    verdict: "Hold",
    conviction: 0.5,
    headline: `Veridia automated diligence on ${company} (synthesis partial — LLM rate limit)`,
    thesis: `Diligence completed with ${agentNames.length} agent(s). ${hasError ? "Some agents encountered errors." : "All agents returned data."} Review raw agent outputs for detail.`,
    keyDrivers: agentNames.filter((k) => !("_error" in ((agents[k] as Record<string, unknown>) ?? {}))).map((k) => `${k} agent data collected`),
    keyRisks: ["Synthesis LLM rate-limited — verdict is default Hold, not a full analysis"],
    contradictions: [],
    openQuestions: ["Full synthesis was rate-limited; re-run for a complete verdict"],
    evidenceTable: [],
  };
}

export async function runSynthesis(args: {
  company: string;
  ticker?: string;
  agents: Record<string, unknown>;
  ctx: TraceContext;
}): Promise<SynthesisResult> {
  try {
    const out = await runAgent("openai", {
      system: SYNTHESIS_SYSTEM,
      user: synthesisUser(args.company, args.ticker, args.agents),
      tools: [],
      tier: "deep",
      maxSteps: 1,
      ctx: args.ctx,
      agentName: "synthesis",
    });
    const parsed = extractJson<SynthesisResult>(out.finalText);
    parsed.replanQuestions ??= [];
    parsed.keyDrivers ??= [];
    parsed.keyRisks ??= [];
    parsed.contradictions ??= [];
    parsed.openQuestions ??= [];
    parsed.evidenceTable ??= [];
    return parsed;
  } catch {
    return fallbackSynthesis(args.company, args.agents);
  }
}
