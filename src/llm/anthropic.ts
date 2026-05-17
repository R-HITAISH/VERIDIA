/**
 * Anthropic tool-calling loop. Used for planner + synthesis (Sonnet for deep
 * reasoning, Haiku for cheap reflection). Anthropic's tool_use blocks are
 * shaped differently than OpenAI's — we normalise here.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { withSpan } from "../omium.js";
import type { AgentRunInput, AgentRunOutput, ToolDef } from "./types.js";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!config.ANTHROPIC_API_KEY)
      throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return _client;
}

function toAnthropicTools(tools: ToolDef[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));
}

export async function runAnthropicAgent(
  input: AgentRunInput,
): Promise<AgentRunOutput> {
  const model =
    input.tier === "fast"
      ? config.ANTHROPIC_MODEL_FAST
      : config.ANTHROPIC_MODEL;
  const maxSteps = input.maxSteps ?? 10;
  const toolMap = new Map(input.tools.map((t) => [t.name, t]));
  const anthTools = toAnthropicTools(input.tools);

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: input.user },
  ];

  let toolCalls = 0;
  let finalText = "";

  for (let step = 0; step < maxSteps; step++) {
    const response = await withSpan(
      input.ctx,
      "llm",
      `${input.agentName}:anthropic:${model}:step${step}`,
      { model, messageCount: messages.length },
      async () =>
        client().messages.create({
          model,
          max_tokens: 4096,
          system: input.system,
          tools: anthTools.length ? anthTools : undefined,
          messages,
          temperature: 0.2,
        }),
    );

    // Append the assistant turn verbatim so tool_use ids align.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        toolCalls++;
        const tool = toolMap.get(block.name);
        if (!tool) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: unknown tool ${block.name}`,
            is_error: true,
          });
          continue;
        }
        try {
          const result = await withSpan(
            input.ctx,
            "tool",
            tool.name,
            block.input,
            async (childCtx) => tool.run(block.input, childCtx),
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content:
              typeof result === "string"
                ? result
                : JSON.stringify(result).slice(0, 60_000),
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // Final answer.
    for (const block of response.content) {
      if (block.type === "text") finalText += block.text;
    }
    break;
  }

  return { finalText, messages: [] as AgentRunOutput["messages"], toolCalls, steps: maxSteps };
}
