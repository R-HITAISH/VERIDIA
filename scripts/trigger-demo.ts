/**
 * Demo trigger. Usage:
 *   npm run demo -- --ticker AAPL --company "Apple Inc." [--thesis "..."]
 *   npm run demo -- --webhook sec-edgar --ticker NVDA --company "NVIDIA"
 */

import "dotenv/config";
import { request } from "undici";
import { createHmac } from "node:crypto";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const port = process.env.PORT || "3000";
  const company = arg("company") ?? "Apple Inc.";
  const ticker = arg("ticker") ?? "AAPL";
  const thesis = arg("thesis");
  const via = arg("webhook"); // "sec-edgar" | "news" | undefined → manual

  const base = `http://localhost:${port}`;
  let url = `${base}/trigger`;
  const body: Record<string, unknown> = { company, ticker, thesis };
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (via === "sec-edgar") {
    url = `${base}/webhooks/sec-edgar`;
    body.filingType = "10-K";
    body.filingUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}&type=10-K`;
    const secret = process.env.WEBHOOK_SHARED_SECRET ?? "change-me";
    const raw = JSON.stringify(body);
    headers["x-veridia-signature"] = createHmac("sha256", secret)
      .update(raw)
      .digest("hex");
  } else if (via === "news") {
    url = `${base}/webhooks/news`;
  }

  console.log(`→ POST ${url}`);
  console.log(`  body: ${JSON.stringify(body)}`);
  const res = await request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.body.json();
  console.log(`← ${res.statusCode}`, json);
  if (typeof json === "object" && json && "runId" in json) {
    console.log(`\nDashboard: ${base}/?runId=${(json as { runId: string }).runId}`);
    console.log(`Status:    ${base}/runs/${(json as { runId: string }).runId}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
