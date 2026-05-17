/**
 * Provider-agnostic tool-calling loop types. Each agent declares a typed tool
 * surface and a final-answer schema; the loop drives the LLM through tool
 * calls until it emits a final answer (or hits maxSteps).
 */

import type { TraceContext } from "../omium.js";

export interface ToolDef<I = unknown, O = unknown> {
  name: string;
  description: string;
  /** JSON schema describing the tool input. Both providers consume this shape. */
  inputSchema: Record<string, unknown>;
  /** The actual implementation. Receives parsed input. */
  run: (input: I, ctx: TraceContext) => Promise<O>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Tool-call metadata (assistant turn that decides to call tools). */
  toolCalls?: ToolCallRecord[];
  /** Set on role="tool" replies. */
  toolCallId?: string;
  toolName?: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: unknown;
}

export interface AgentRunInput {
  system: string;
  user: string;
  tools: ToolDef[];
  maxSteps?: number;
  /** "fast" routes to gpt-4o-mini / haiku; "deep" routes to gpt-4o / sonnet. */
  tier?: "fast" | "deep";
  ctx: TraceContext;
  /** Display name for tracing. */
  agentName: string;
}

export interface AgentRunOutput {
  finalText: string;
  messages: ChatMessage[];
  toolCalls: number;
  steps: number;
}

export type Provider = "openai" | "anthropic";
