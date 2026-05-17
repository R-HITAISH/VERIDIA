/**
 * Exa semantic search — better for dev-heavy / niche queries (e.g. "open
 * source vector databases with sub-millisecond p99"). Used by Tech, Market.
 */

import Exa from "exa-js";
import { config } from "../config.js";
import type { ToolDef } from "../llm/types.js";

let _exa: Exa | null = null;
function client(): Exa {
  if (!_exa) {
    if (!config.EXA_API_KEY) throw new Error("EXA_API_KEY not set");
    _exa = new Exa(config.EXA_API_KEY);
  }
  return _exa;
}

export const exaSearchTool: ToolDef = {
  name: "exa_semantic_search",
  description:
    "Neural/semantic web search via Exa. Better than keyword search for technical and niche queries (developer docs, research, github discussions).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      num_results: { type: "integer", minimum: 1, maximum: 10, description: "Number of results (1-10, default 5)." },
      include_text: {
        type: "boolean",
        description: "If true, return excerpted page text (default true).",
      },
    },
    required: ["query"],
  },
  run: async (raw) => {
    const p = raw as Record<string, unknown>;
    const query = p.query as string;
    const num_results = p.num_results !== undefined ? Number(p.num_results) : 5;
    const include_text = p.include_text !== undefined ? Boolean(p.include_text) : true;
    if (!config.EXA_API_KEY) {
      return {
        note: "[Exa API key not configured]",
        results: [],
      };
    }
    const res = await client().searchAndContents(query, {
      numResults: num_results,
      ...(include_text ? { text: { maxCharacters: 1500 } } : {}),
    });
    return {
      results: res.results.map((r) => ({
        title: r.title,
        url: r.url,
        publishedDate: r.publishedDate,
        text: (r as unknown as { text?: string }).text?.slice(0, 1500),
      })),
    };
  },
};
