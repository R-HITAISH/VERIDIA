/**
 * Tavily web search — broad, news-friendly. Used by Market, Team, Risk agents.
 * Docs: https://docs.tavily.com/docs/rest-api/api-reference
 */

import { request } from "undici";
import { config } from "../config.js";
import type { ToolDef } from "../llm/types.js";

interface TavilyParams {
  query: string;
  max_results?: number;
  search_depth?: "basic" | "advanced";
  topic?: "general" | "news";
  days?: number;
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
}

interface TavilyResponse {
  answer?: string;
  results: TavilyResult[];
}

async function tavilySearch(
  params: TavilyParams,
): Promise<{ answer?: string; results: TavilyResult[] }> {
  if (!config.TAVILY_API_KEY) {
    return {
      answer: "[Tavily API key not configured — returning empty result]",
      results: [],
    };
  }
  const res = await request("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: config.TAVILY_API_KEY,
      query: params.query,
      max_results: params.max_results ?? 5,
      search_depth: params.search_depth ?? "advanced",
      topic: params.topic ?? "general",
      days: params.days,
      include_answer: true,
    }),
  });
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    throw new Error(`Tavily ${res.statusCode}: ${body.slice(0, 200)}`);
  }
  const json = (await res.body.json()) as TavilyResponse;
  return {
    answer: json.answer,
    results: (json.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content?.slice(0, 1500) ?? "",
      published_date: r.published_date,
      score: r.score,
    })),
  };
}

export const tavilySearchTool: ToolDef = {
  name: "web_search",
  description:
    "Search the open web via Tavily. Returns titles, URLs, content snippets, and a synthesised answer. Use for news, market data, competitor intel, and team background checks.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural language search query." },
      max_results: { type: "integer", minimum: 1, maximum: 10, description: "Number of results (1-10, default 5)." },
      topic: { type: "string", enum: ["general", "news"], description: "Search topic type (default: general)." },
      days: {
        type: "integer",
        description: "If topic=news, restrict to last N days (e.g. 30).",
      },
    },
    required: ["query"],
  },
  run: async (raw) => {
    const p = raw as Record<string, unknown>;
    const coerced: TavilyParams = {
      query: p.query as string,
      max_results: p.max_results !== undefined ? Number(p.max_results) : undefined,
      search_depth: p.search_depth as TavilyParams["search_depth"],
      topic: p.topic as TavilyParams["topic"],
      days: p.days !== undefined ? Number(p.days) : undefined,
    };
    return tavilySearch(coerced);
  },
};
