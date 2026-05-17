/**
 * Slack delivery via Incoming Webhook. Posts a richly-formatted summary plus
 * a link to the final PDF (when reachable). This is the real side-effect that
 * proves "ships real work, end-to-end".
 */

import { request } from "undici";
import { config } from "../config.js";

export interface SlackMemoPayload {
  runId: string;
  company: string;
  ticker?: string;
  verdict: string;
  conviction: number;
  headline: string;
  keyRisks: string[];
  reportUrl: string;
}

export async function postMemoToSlack(p: SlackMemoPayload): Promise<boolean> {
  if (!config.SLACK_WEBHOOK_URL) return false;
  const body = {
    text: `*Veridia memo: ${p.company}${p.ticker ? ` (${p.ticker})` : ""}* — ${p.verdict}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Veridia · ${p.company}${p.ticker ? ` (${p.ticker})` : ""}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Verdict:*\n${p.verdict}` },
          {
            type: "mrkdwn",
            text: `*Conviction:*\n${(p.conviction * 100).toFixed(0)}%`,
          },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Headline*\n${p.headline}` },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*Key risks*\n" +
            (p.keyRisks.length
              ? p.keyRisks.map((r) => `• ${r}`).join("\n")
              : "_None flagged._"),
        },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `Run \`${p.runId}\` · <${p.reportUrl}|Open full PDF memo>` },
        ],
      },
    ],
  };
  const res = await request(config.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.statusCode < 400;
}
