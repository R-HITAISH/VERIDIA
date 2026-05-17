# Veridia — 5-Minute Demo Script

> The submitted screen-recorded video is the primary surface for axes 01, 02, 04, and 05 (55% of the score). Do not improvise it. Run this script twice end-to-end before recording.

## Pre-flight checklist (done day-of)

- [ ] `npm install` clean, `npm run typecheck` green
- [ ] `.env` populated with: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `GITHUB_TOKEN`, `SLACK_WEBHOOK_URL`, `OMIUM_API_KEY`, `OMIUM_PROJECT_ID`
- [ ] `npm run redis:up` — Redis healthy on :6379
- [ ] `npm run dev` — Fastify online, all 4 workers started
- [ ] Browser tab open at `http://localhost:3000`
- [ ] Slack channel visible in a second window
- [ ] Omium dashboard open in a third tab (logged in, project selected)
- [ ] `./reports/` is empty (so the new PDF is unambiguous)
- [ ] OBS / screen recorder framed to capture: dashboard + Slack + Omium

## Beat sheet (5:00 total)

**00:00–00:30 · The problem (30s).** One sentence: every fund pays analysts to write the same 5-page memo when a watchlist company files an 8-K. Show the empty `reports/` folder. Say: "In 5 minutes you'll watch one webhook produce one of those memos with zero human input."

**00:30–01:00 · The trigger (30s).** Switch to dashboard. Select "sec-edgar webhook" as source. Enter `NVIDIA` + `NVDA`. Hit *Fire Diligence Run*. Narrate: "This is a real HMAC-signed webhook hitting `/webhooks/sec-edgar`. In production this fires when EDGAR publishes the filing."

**01:00–02:30 · Autonomous fan-out (90s).** Watch the Live Agent Events panel fill in. Call out:
- `status → planning` — "Claude Sonnet just produced a 5-task JSON plan"
- 5 `agent.start` events — "5 sub-agents dispatched to BullMQ in parallel"
- `agent.done` events arriving out of order — "they finish independently; Financial usually first because SEC EDGAR is fast"
- Switch to Omium dashboard mid-stream: show the live trace tree. Point at causal links: the orchestrator span has 5 sub-agent children, each sub-agent has tool-call children.

**02:30–03:30 · The hard part (60s).** Synthesis fires. If you're lucky and synthesis requests a re-plan (it sometimes does on NVDA because the planner under-specifies the AI-chips competitive set), narrate: "Synthesis just rejected the first wave. It's asking the orchestrator for a follow-up on competitor X. This is the branching control flow — agents arguing." If no re-plan, narrate the cross-check: "Synthesis is comparing the financial trail to the market sizing claim. Watch — it found a contradiction."

**03:30–04:30 · The artifact (60s).** Status flips to `done`. Click the *Open PDF memo* link. Walk pages 1–3 fast: verdict box, key drivers, key risks, contradictions panel (if any), evidence table with clickable source URLs. Then alt-tab to Slack: the same memo posted as a rich card with a verdict pill and a *Open full PDF* deep link.

**04:30–05:00 · The receipts (30s).** Return to Omium. Click the run's root span. Show the trace tree fully expanded: every LLM call, every tool call, every queue dispatch, all causally linked. Say: "Every claim in that memo traces back to a tool call you can audit. Nothing was hallucinated — if it's in the PDF, it appeared in the trace."

## What to do if something breaks

- **A sub-agent fails**: don't panic. Narrate it: "Risk agent just rate-limited Tavily. Notice the run did not abort — the memo is going to ship with a flagged Risk section instead. This is the independent-failure guarantee."
- **Synthesis returns garbage JSON**: the agent retries once automatically. If it fails again, kill the synthesis worker process in your terminal and restart it with `npm run dev` — show the run resume from Redis state. This is actually the strongest moment: it proves crash-safety on live tape.
- **Slack post fails**: open the local PDF file directly. The memo on disk is the deliverable; Slack is the delivery channel.

## Talking points to drop verbatim (for the panel Q&A)

- "Sub-agent tool surfaces are *sealed* — not prompt constraints. The MarketAgent's tool list literally does not include SEC EDGAR."
- "Run state is in Redis hashes. The workers are stateless. You can kill them and restart — the run resumes."
- "Synthesis can send the run back to the planner. We cap at one re-plan for demo determinism, but the branching is genuine."
- "Every span has a parent ID. The Omium trace graph and the BullMQ topology are the same tree."
