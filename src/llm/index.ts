import { runOpenAIAgent } from "./openai.js";
import { runAnthropicAgent } from "./anthropic.js";
import type { AgentRunInput, AgentRunOutput, Provider } from "./types.js";

export async function runAgent(
  provider: Provider,
  input: AgentRunInput,
): Promise<AgentRunOutput> {
  return provider === "anthropic"
    ? runAnthropicAgent(input)
    : runOpenAIAgent(input);
}

export type { AgentRunInput, AgentRunOutput, Provider } from "./types.js";
export type { ToolDef, ChatMessage } from "./types.js";
