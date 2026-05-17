/**
 * OpenAI tool-calling loop. Used for sub-agent workers (gpt-4o /
 * gpt-4o-mini). Reliable function-calling, fast.
 */

import OpenAI from "openai";
import { config } from "../config.js";
import { withSpan, type TraceContext } from "../omium.js";
import type { AgentRunInput, AgentRunOutput, ToolDef } from "./types.js";

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    if (!config.OPENAI_API_KEY)
      throw new Error("OPENAI_API_KEY is not set");
    _client = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      // Allow routing to OpenAI-compatible providers (Groq, OpenRouter, Together, Ollama, etc.)
      ...(config.OPENAI_BASE_URL ? { baseURL: config.OPENAI_BASE_URL } : {}),
    });
  }
  return _client;
}

function toOpenAITools(tools: ToolDef[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export async function runOpenAIAgent(
  input: AgentRunInput,
): Promise<AgentRunOutput> {
  const model =
    input.tier === "deep" ? config.OPENAI_MODEL : config.OPENAI_MODEL_FAST;
  const maxSteps = input.maxSteps ?? 8;
  const toolMap = new Map(input.tools.map((t) => [t.name, t]));
  const oaiTools = toOpenAITools(input.tools);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: "system", content: input.system },
    { role: "user", content: input.user },
  ];

  let toolCalls = 0;
  let finalText = "";

  for (let step = 0; step < maxSteps; step++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let completion: any;
    let retries = 0;
    while (true) {
      try {
        completion = await withSpan(
          input.ctx,
          "llm",
          `${input.agentName}:openai:${model}:step${step}`,
          { model, messageCount: messages.length },
          async () =>
            client().chat.completions.create({
              model,
              messages,
              tools: oaiTools.length ? oaiTools : undefined,
              tool_choice: oaiTools.length ? "auto" : undefined,
              temperature: 0.2,
            }),
        );
        break;
      } catch (err: unknown) {
        const isRateLimit =
          err instanceof Error &&
          (err.message.includes("429") || err.message.includes("rate_limit") || (err as { status?: number }).status === 429);
        if (isRateLimit && retries < 5) {
          const delay = Math.min(2000 * Math.pow(2, retries), 30000);
          await new Promise((r) => setTimeout(r, delay));
          retries++;
          continue;
        }
        throw err;
      }
    }

    const choice = completion.choices[0];
    if (!choice) break;
    const msg = choice.message;
    messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        if (call.type !== "function") continue;
        const tool = toolMap.get(call.function.name);
        toolCalls++;
        if (!tool) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `Error: unknown tool ${call.function.name}`,
          });
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(call.function.arguments || "{}");
        } catch {
          parsed = {};
        }
        try {
          const result = await withSpan(
            input.ctx,
            "tool",
            tool.name,
            parsed,
            async (childCtx) => tool.run(parsed, childCtx),
          );
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content:
              typeof result === "string"
                ? result
                : JSON.stringify(result).slice(0, 60_000),
          });
        } catch (err) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
      continue;
    }

    finalText = msg.content ?? "";
    break;
  }

  return {
    finalText,
    messages: messages as AgentRunOutput["messages"],
    toolCalls,
    steps: maxSteps,
  };
}

export { type TraceContext };
