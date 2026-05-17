/**
 * SEC EDGAR — free, official. The "killer" tool for the FinancialAgent
 * because it grounds the memo in verifiable primary-source data.
 *
 * Two surfaces used:
 *   1. /cgi-bin/browse-edgar?action=getcompany&CIK=... (ticker→CIK lookup)
 *   2. data.sec.gov/api/xbrl/companyfacts/CIK#########.json (structured facts)
 *   3. data.sec.gov/submissions/CIK#########.json (recent filings)
 *
 * SEC requires a descriptive User-Agent. Configured via SEC_EDGAR_USER_AGENT.
 */

import { request } from "undici";
import { config } from "../config.js";
import type { ToolDef } from "../llm/types.js";

const headers = () => ({
  "User-Agent": config.SEC_EDGAR_USER_AGENT,
  Accept: "application/json",
});

interface CompanyTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

let _tickerMap: Map<string, CompanyTickerEntry> | null = null;
async function loadTickers(): Promise<Map<string, CompanyTickerEntry>> {
  if (_tickerMap) return _tickerMap;
  const res = await request("https://www.sec.gov/files/company_tickers.json", {
    headers: headers(),
  });
  if (res.statusCode >= 400) throw new Error(`SEC tickers ${res.statusCode}`);
  const json = (await res.body.json()) as Record<string, CompanyTickerEntry>;
  const m = new Map<string, CompanyTickerEntry>();
  for (const v of Object.values(json)) m.set(v.ticker.toUpperCase(), v);
  _tickerMap = m;
  return m;
}

const padCik = (cik: number) => String(cik).padStart(10, "0");

async function resolveCik(
  ticker: string,
): Promise<{ cik: string; title: string } | null> {
  const map = await loadTickers();
  const entry = map.get(ticker.toUpperCase());
  if (!entry) return null;
  return { cik: padCik(entry.cik_str), title: entry.title };
}

interface CompanyFactsResponse {
  cik: number;
  entityName: string;
  facts?: {
    "us-gaap"?: Record<
      string,
      {
        label?: string;
        description?: string;
        units?: Record<
          string,
          Array<{
            end: string;
            val: number;
            fy?: number;
            fp?: string;
            form?: string;
          }>
        >;
      }
    >;
  };
}

/** Compact a heavy companyfacts payload down to the 10–15 metrics we actually want. */
function summariseFacts(facts: CompanyFactsResponse) {
  const wanted = [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "GrossProfit",
    "OperatingIncomeLoss",
    "NetIncomeLoss",
    "CashAndCashEquivalentsAtCarryingValue",
    "Assets",
    "Liabilities",
    "StockholdersEquity",
    "ResearchAndDevelopmentExpense",
    "EarningsPerShareBasic",
  ];
  const gaap = facts.facts?.["us-gaap"] ?? {};
  const out: Record<
    string,
    { label?: string; latest?: { end: string; val: number; form?: string; fy?: number }; trail?: Array<{ end: string; val: number }> }
  > = {};
  for (const key of wanted) {
    const entry = gaap[key];
    if (!entry) continue;
    const usd = entry.units?.USD ?? entry.units?.["USD/shares"];
    if (!usd || usd.length === 0) continue;
    const sorted = [...usd].sort((a, b) => a.end.localeCompare(b.end));
    const trail = sorted.slice(-6).map((p) => ({ end: p.end, val: p.val }));
    const latest = sorted[sorted.length - 1];
    out[key] = {
      label: entry.label,
      latest: latest
        ? { end: latest.end, val: latest.val, form: latest.form, fy: latest.fy }
        : undefined,
      trail,
    };
  }
  return { entityName: facts.entityName, cik: facts.cik, metrics: out };
}

export const secCompanyFactsTool: ToolDef = {
  name: "sec_company_facts",
  description:
    "Fetch structured financial facts from SEC EDGAR XBRL for a US-listed company (revenue, net income, assets, cash, R&D, EPS, etc.) including trailing values. Input is a ticker (e.g. AAPL).",
  inputSchema: {
    type: "object",
    properties: {
      ticker: { type: "string", description: "Stock ticker, e.g. AAPL" },
    },
    required: ["ticker"],
  },
  run: async (raw) => {
    const { ticker } = raw as { ticker: string };
    const resolved = await resolveCik(ticker);
    if (!resolved)
      return { error: `Ticker ${ticker} not found in SEC EDGAR registry.` };
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${resolved.cik}.json`;
    const res = await request(url, { headers: headers() });
    if (res.statusCode === 404)
      return {
        ticker,
        cik: resolved.cik,
        note: "No XBRL facts on file (foreign issuer or early-stage).",
      };
    if (res.statusCode >= 400)
      throw new Error(`SEC facts ${res.statusCode} for ${ticker}`);
    const json = (await res.body.json()) as CompanyFactsResponse;
    return summariseFacts(json);
  },
};

interface SubmissionsResponse {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

export const secRecentFilingsTool: ToolDef = {
  name: "sec_recent_filings",
  description:
    "List the most recent SEC filings (10-K, 10-Q, 8-K, S-1, etc.) for a ticker, with direct URLs to the primary document.",
  inputSchema: {
    type: "object",
    properties: {
      ticker: { type: "string" },
      limit: { type: "integer", maximum: 25, description: "Max filings to return (default 10)." },
      formFilter: {
        type: "string",
        description: "Optional form type filter (e.g. '10-K', '8-K').",
      },
    },
    required: ["ticker"],
  },
  run: async (raw) => {
    const { ticker, limit = 10, formFilter } = raw as {
      ticker: string;
      limit?: number;
      formFilter?: string;
    };
    const resolved = await resolveCik(ticker);
    if (!resolved) return { error: `Ticker ${ticker} not found.` };
    const url = `https://data.sec.gov/submissions/CIK${resolved.cik}.json`;
    const res = await request(url, { headers: headers() });
    if (res.statusCode >= 400)
      throw new Error(`SEC submissions ${res.statusCode}`);
    const json = (await res.body.json()) as SubmissionsResponse;
    const r = json.filings.recent;
    const filings: Array<{
      form: string;
      filingDate: string;
      reportDate: string;
      description: string;
      url: string;
    }> = [];
    for (let i = 0; i < r.form.length && filings.length < limit; i++) {
      if (formFilter && r.form[i] !== formFilter) continue;
      const accession = (r.accessionNumber[i] ?? "").replace(/-/g, "");
      const doc = r.primaryDocument[i];
      filings.push({
        form: r.form[i] ?? "",
        filingDate: r.filingDate[i] ?? "",
        reportDate: r.reportDate[i] ?? "",
        description: r.primaryDocDescription[i] ?? "",
        url: `https://www.sec.gov/Archives/edgar/data/${Number(resolved.cik)}/${accession}/${doc}`,
      });
    }
    return { entityName: json.name, cik: resolved.cik, filings };
  },
};

export { resolveCik };
