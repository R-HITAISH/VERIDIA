# Veridia — 3-Page Writeup

> **Scaler Ascent · Anvil · Problem Statement 3** — *Multi-agent autonomy that ships real work, end-to-end.*
> Export this file to PDF (e.g. `pandoc -o WRITEUP.pdf WRITEUP.md` or VS Code "Markdown PDF") to produce the submission deliverable.

---

## 1. The problem we chose, and why it deserves an autonomous pipeline

Every venture, growth, public-equity and credit fund employs junior analysts whose first 6 months on the job are spent doing the same task: when a watchlist company files an 8-K, raises a round, or appears in a news cycle, build a 5–10 page investment memo that pulls together market context, financials, engineering signal, founder background, and risk flags. The work is rote, decision-shaped, and overwhelmingly bottlenecked on humans.

We picked this problem because the four hallmarks of *real* autonomy stack naturally:

- **Webhooks are load-bearing**: funds genuinely want to react the moment SEC EDGAR publishes a filing. The "trigger" is not invented for the demo.
- **Multi-agent decomposition is non-cosmetic**: the work fans cleanly into 5 sub-investigations whose tool surfaces *should not overlap* — the FinancialAgent has no business reading GitHub, and the TechAgent has no business reading 10-Ks.
- **Async / long-running is necessary**: a wave of sub-agents takes 30–90 seconds of LLM + API work each. Doing this synchronously would block a webhook. BullMQ on Redis is the natural fit.
- **The deliverable is tangible**: a polished PDF dropped into Slack. Judges hold up a real artifact, not a screenshot of a chat.

The user the product targets is a junior analyst or a fund's "research-ops" function. The marginal cost of a Veridia memo is ~$0.50 in API spend; the time saved per memo is 4–12 analyst-hours.

## 2. Agent architecture & autonomy contract

```
Webhook (SEC EDGAR / news / manual)
        │
        ▼  Fastify ingress → Redis run state
┌────────────────────────────┐
│ Orchestrator (Claude Sonnet 4) │ — produces JSON plan
└────────────────────────────┘
        │ BullMQ fan-out, parallel
        ├─► Market    (Tavily + Exa)
        ├─► Financial (SEC EDGAR XBRL + filings + Tavily)
        ├─► Tech      (GitHub org + repo health + Exa)
        ├─► Team      (Tavily + Exa)
        └─► Risk      (Tavily)
                │ each writes typed JSON to Redis
                ▼
┌────────────────────────────┐
│ Synthesis  (Claude Sonnet 4) │ — cross-checks, scores, flags contradictions
└────────────────────────────┘
        │ branch: if gaps → re-plan (back to Orchestrator)
        ▼
┌────────────────────────────┐
│ Report  (React-PDF + Slack)│ — generates memo, posts to Slack
└────────────────────────────┘
                │
                ▼  Omium SDK traces every step (bonus +10%)
```

**Sealed tool surfaces.** Each sub-agent gets a whitelisted set of tools defined in `src/tools/index.ts`. The MarketAgent literally cannot call SEC EDGAR — this isn't a prompt-level constraint, it's an unwritable hole in its tool list. The result: agents stay in their lane and the synthesis stage can attribute every claim to a specific source agent (and from there to a specific source URL).

**Real autonomy, not scripted prompts.** The Orchestrator decides *which* sub-agents to dispatch for *this* trigger, and what objective to give each one (e.g. for a software company it dispatches Tech; for a retailer it doesn't). The Synthesis agent has the right to *reject* the first wave and ask the Orchestrator to re-plan with targeted follow-up questions. We cap re-plans at 1 to keep demos predictable, but the branching control flow is genuinely agent-driven.

**Crash-safety.** Every step is a BullMQ job with 2–3 attempts and exponential backoff. Run state lives in Redis hashes (`veridia:run:<id>`, `veridia:run:<id>:agent:<kind>`). Killing all workers mid-run and restarting `npm run dev` resumes from the last committed step — no lost work. We demo this explicitly.

**Independent failure.** If RiskAgent crashes on rate-limits, the run does *not* abort. The agent's result is replaced with a structured error, Synthesis sees the gap, and the memo ships with a flagged Risk section instead of dying.

## 3. Engineering choices and trade-offs

| Decision | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 + TypeScript strict | Same surface as the analyst tooling we'd integrate with later (Slack, Linear). Strict TS keeps prompts and tool contracts honest. |
| Queue | BullMQ on Redis | Battle-tested, durable, observable. The natural Node primitive for "fan out, settle, fan in". |
| Planner LLM | Claude Sonnet 4 | Strongest at producing strict-JSON multi-step plans and at the cross-checking required by Synthesis. |
| Worker LLM | OpenAI gpt-4o | Most reliable function-calling under high tool-density; cheap enough to run 5 parallel sub-agents. |
| Web search | Tavily (broad/news) + Exa (semantic) | Different recall profiles. The Orchestrator uses both; the MarketAgent has access to both. |
| Financials | SEC EDGAR (free, official) | The single most defensible primary source. The FinancialAgent grounds every claim in a real filing URL. |
| Engineering signal | GitHub REST API | The cheapest way to discriminate a software company that *ships* from one that *talks*. Headline-repo contributor count and 90-day commit velocity are the high-signal cuts. |
| Delivery | React-PDF + Slack incoming webhook | Both produce verifiable side-effects judges can inspect during the demo. |
| Tracing | Omium SDK (optional, +10% bonus) | We instrument every span: webhook, orchestrator, each sub-agent, each tool call, synthesis, report. Causal parent/child IDs link the trace graph to the queue topology. |

**What we deliberately did *not* build.** We avoided Crunchbase / LinkedIn integrations because they are paid + gated and would make the demo unreliable. The TeamAgent uses Tavily/Exa over a curated query template — slower but reliably free. We avoided a custom agent framework in favour of a thin provider-agnostic tool-calling loop (`src/llm/openai.ts`, `src/llm/anthropic.ts`) so the code is auditable in an evening. We avoided streaming partial agent outputs to the dashboard — the dashboard subscribes to a Redis event list via SSE, which is simpler and survives reconnects.

**What we'd build next.** Per-fund prompt overrides (a hedge fund cares about different risks than a growth fund); a memo "diff" view across re-plans; replacing the Tavily team-research path with a structured people-data provider once budget allows; and a true watchlist daemon that watches the EDGAR full-text feed and self-triggers Veridia rather than relying on the webhook simulator we ship.

**Bottom line.** Veridia takes one webhook in, runs six autonomous agents over five real APIs across two LLM providers, cross-checks the result, and drops a polished PDF in Slack — typically in 3–6 minutes, with zero human steering and full traceability on the Omium dashboard. It is the kind of pipeline a fund would put in production tomorrow.
