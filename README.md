# Veridia — Autonomous Investment Due-Diligence Engine

> A multi-agent autonomous pipeline that watches for new SEC filings (or accepts a manual trigger), spins up a fleet of specialised agents that investigate the target across market, financials, technology, team, and risk vectors **in parallel**, cross-checks their findings, and delivers a professional **PDF investment memo** — all without human steering.

Built for **Scaler Ascent · Anvil · Problem Statement 3** — *Multi-agent autonomy that ships real work, end-to-end.*

---

## Why this is a real workflow, not a demo

Every VC/PE/credit fund pays junior analysts to do exactly this work — gather public information about a company across ~15 sources, reconcile contradictions, and produce a 5–10 page memo. It takes 4–12 hours per company. Funds receive dozens of leads per week. The result is a backlog and inconsistent coverage.

Veridia turns one webhook (SEC EDGAR new-filing notification, a TechCrunch RSS-to-webhook, or an analyst dropping a ticker into a form) into a delivered memo in **~3–6 minutes**. The webhook is **load-bearing**, not cosmetic.

---

## Architecture

```
SEC EDGAR webhook  ─┐
TechCrunch RSS ─────┤── ► Fastify ingress ──► Orchestrator (Llama 3.3 70B via Groq)
Manual trigger  ────┘                              │ plans investigation
                                                   │
                                       BullMQ fan-out (Redis)
                                                   │
        ┌──────────┬──────────┬──────────┬─────────┴─┬──────────┐
        ▼          ▼          ▼          ▼           ▼          ▼
     Market    Financial    Tech       Team        Risk      (ad-hoc follow-ups)
     (Tavily/  (SEC EDGAR  (GitHub    (Web        (News /
      Exa)     XBRL)        API)       search)    sanctions)
        │          │          │          │           │
        └──────────┴────┬─────┴──────────┴───────────┘
                        ▼
                Redis run-state aggregator
                        ▼
         Synthesis agent (Llama 3.3 70B — deep reasoning)
                        │  cross-checks claims, flags contradictions, scores
                        ▼
              Report agent → React-PDF memo → Slack delivery
                        ▼
              Omium SDK traces every step (+10% bonus axis)
```

---

## Tech Stack

| Layer            | Choice                                                                    |
|------------------|---------------------------------------------------------------------------|
| Runtime          | Node.js 20 + TypeScript (strict)                                          |
| Web              | Fastify 5 (webhook ingress + status API + live dashboard)                 |
| Queues           | BullMQ on Redis 7 (durable fan-out, retries, crash-safe)                  |
| State            | Redis hashes per run — survives worker crashes                            |
| Planner agent    | Groq `llama-3.3-70b-versatile` (deep reasoning + reflection)              |
| Worker agents    | Groq `llama-3.1-8b-instant` (fast, tool-heavy sub-agents)                 |
| Synthesis        | Groq `llama-3.3-70b-versatile`                                            |
| Web search       | Tavily (broad/news), Exa (semantic/dev-heavy queries)                     |
| Financial data   | SEC EDGAR free API — company facts + 10-K/10-Q filings                    |
| Code signals     | GitHub REST API (repo health, contributor velocity, language mix)         |
| PDF generation   | React-PDF (professional memo layout)                                      |
| Delivery         | Slack incoming webhook                                                    |
| Tracing (bonus)  | Omium SDK — every agent step, tool call, and async dispatch traced        |

---

## Quickstart

### Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **Docker Desktop** — [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop) (for Redis)
- **Free API keys** (see below)

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/veridia.git
cd veridia
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Where to get it | Required |
|---|---|---|
| `OPENAI_API_KEY` | [console.groq.com](https://console.groq.com) (free) | ✅ |
| `OPENAI_BASE_URL` | Set to `https://api.groq.com/openai/v1` | ✅ |
| `OPENAI_MODEL` | Set to `llama-3.3-70b-versatile` | ✅ |
| `OPENAI_MODEL_FAST` | Set to `llama-3.1-8b-instant` | ✅ |
| `TAVILY_API_KEY` | [app.tavily.com](https://app.tavily.com) (free tier) | ✅ |
| `SLACK_WEBHOOK_URL` | Slack App → Incoming Webhooks | optional |
| `OMIUM_API_KEY` | [omium.ai](https://omium.ai) | optional |

### 3. Start Redis

```bash
docker-compose up -d
```

### 4. Start the server

```bash
npm run dev
```

You should see `veridia online` with `port: 3000`.

### 5. Fire a demo run

Open a **second terminal**:

```bash
npm run demo -- --ticker NVDA --company "NVIDIA Corporation" --webhook sec-edgar
```

### 6. Watch the dashboard

Open **http://localhost:3000** — live agent events update in real time.

When the run completes, the PDF memo is saved to `./reports/<runId>.pdf`.

---

## Webhook Surface

| Endpoint | Trigger |
|---|---|
| `POST /trigger` | Manual — `{ ticker, company, thesis? }` |
| `POST /webhooks/sec-edgar` | SEC EDGAR new-filing (HMAC-verified) |
| `POST /webhooks/news` | Generic news/RSS-to-webhook |
| `GET  /runs/:id` | Run state + memo URL |
| `GET  /runs/:id/stream` | Live agent events (SSE) |

---

## Multi-Agent Design

Each sub-agent is a self-contained tool-calling loop with:

- **A sealed system prompt** describing its role and forbidden actions
- **A whitelisted tool set** — e.g. `FinancialAgent` cannot call GitHub
- **Independent failure** — if `RiskAgent` crashes, the memo still ships with a flagged section

The orchestrator can spawn **ad-hoc follow-up** sub-investigations after the first wave returns (e.g. *"MarketAgent surfaced a competitor — spawn a TechAgent run on their GitHub org"*). This is what makes it genuinely autonomous rather than a static DAG.

---

## Autonomy Guarantees

- **Crash-safe** — every agent job is a BullMQ task with retries + exponential backoff. Redis persists run state across restarts.
- **No human in the loop** — the orchestrator decides which sub-agents to run, when to spawn follow-ups, when synthesis is ready, and when to deliver.
- **Branching** — synthesis can send the run back to the planner with a "missing evidence" verdict, triggering targeted re-investigation before publishing.

---

## Project Layout

```
src/
  index.ts              # entry point — starts Fastify + all BullMQ workers
  config.ts             # zod-validated env config
  logger.ts             # pino structured logging
  omium.ts              # Omium SDK wrapper with no-op fallback
  llm/
    openai.ts           # OpenAI-compatible tool-calling loop (Groq, OpenAI, etc.)
    anthropic.ts        # Anthropic tool-calling loop
    index.ts            # unified runAgent() entry point
  queue/
    index.ts            # BullMQ queue + job type definitions
  state/
    store.ts            # Redis-backed run state store
  tools/
    tavily.ts           # Tavily web search
    exa.ts              # Exa semantic search
    sec-edgar.ts        # SEC EDGAR financial data
    github.ts           # GitHub engineering signals
    slack.ts            # Slack memo delivery
    index.ts            # per-agent whitelisted tool sets
  agents/
    orchestrator.ts     # planning + re-planning logic
    subagent.ts         # generic sub-agent invocation
    synthesis.ts        # cross-check + scoring
    util.ts             # JSON extraction helpers
  workers/
    orchestrator.worker.ts
    subagent.worker.ts
    synthesis.worker.ts
    report.worker.ts
  server/
    app.ts              # Fastify routes + SSE dashboard
  report/
    render.tsx          # React-PDF memo template
    generate.ts         # PDF generation
  prompts/
    index.ts            # versioned prompts for all agents
scripts/
  trigger-demo.ts       # CLI: fire a demo run
public/
  index.html            # live dashboard UI
docs/
  WRITEUP.md            # project writeup
  DEMO_SCRIPT.md        # demo recording script
```

---

## Evaluation Alignment

| Axis | How Veridia scores |
|---|---|
| 01 Problem Relevance · 20% | Delivered PDF memo is a real artifact a fund analyst uses daily |
| 02 Autonomous Execution · 25% | Webhook → memo with zero prompts; branching, retries, follow-up investigations |
| 03 Multi-Agent Quality · 20% | 6+ specialised agents, sealed tools, synthesis cross-check, planner can re-plan |
| 04 Tooling & Integrations · 15% | 5 real APIs: Tavily, Exa, SEC EDGAR, GitHub, Slack |
| 05 Demo Video · 10% | Single webhook → live dashboard → PDF artifact opens |
| 06 Architecture · 10% | Clean BullMQ/Redis fan-out, typed contracts, Omium + pino observability |
| Bonus · Omium Tracing · +10% | Every agent step, tool call, webhook, and dispatch traced and causally linked |

---

## License

MIT.
