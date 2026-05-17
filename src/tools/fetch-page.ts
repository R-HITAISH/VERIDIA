/**
 * Free direct URL fetcher — visits any public URL and returns clean readable text.
 * No API key required. Used by agents to read authoritative pages directly:
 *   - investor.apple.com, newsroom, press releases
 *   - SEC EDGAR filing documents
 *   - Company annual reports, earnings releases
 */

import { request } from "undici";
import type { ToolDef } from "../llm/types.js";

const MAX_CHARS = 8000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const fetchPageTool: ToolDef = {
  name: "fetch_page",
  description:
    "Fetch and read the text content of any public URL — company investor pages, newsrooms, SEC filings, press releases, annual reports. Free, no API key. Returns clean readable text up to 8000 chars.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Full URL to fetch (must start with https:// or http://).",
      },
    },
    required: ["url"],
  },
  run: async (raw) => {
    const { url } = raw as { url: string };
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { error: "URL must start with http:// or https://" };
    }
    try {
      const res = await request(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Veridia/1.0; +https://github.com/R-HITAISH/veridia)",
          Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
        },
      });
      if (res.statusCode >= 400) {
        return { error: `HTTP ${res.statusCode} fetching ${url}` };
      }
      const contentType = (res.headers["content-type"] as string) ?? "";
      const raw = await res.body.text();
      const text = contentType.includes("html") ? stripHtml(raw) : raw;
      return {
        url,
        statusCode: res.statusCode,
        text: text.slice(0, MAX_CHARS),
        truncated: text.length > MAX_CHARS,
      };
    } catch (err) {
      return { error: `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
