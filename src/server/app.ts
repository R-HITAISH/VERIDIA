/**
 * Fastify app: webhook ingress + run status API + dashboard static files +
 * served reports + SSE event stream.
 */

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";

import { config } from "../config.js";
import { logger } from "../logger.js";
import { queues } from "../queue/index.js";
import {
  createRun,
  getRun,
  getEvents,
  type RunTrigger,
} from "../state/store.js";
import { withSpan, rootCtx } from "../omium.js";

export async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(fastifyCors, { origin: "*" });

  // Serve the dashboard
  await app.register(fastifyStatic, {
    root: path.resolve(process.cwd(), "public"),
    prefix: "/",
    decorateReply: true,
  });

  // Serve generated PDFs
  await app.register(fastifyStatic, {
    root: path.resolve(process.cwd(), "reports"),
    prefix: "/reports/",
    decorateReply: false,
  });

  async function dispatchRun(trigger: RunTrigger): Promise<string> {
    const runId = nanoid(10);
    await createRun(runId, trigger);
    const ctx = rootCtx(runId);
    await withSpan(
      ctx,
      "webhook",
      `trigger:${trigger.source}`,
      trigger,
      async () => {
        await queues.orchestrator.add(
          `${runId}.orchestrate.${Date.now()}`,
          { runId },
          { jobId: `${runId}.orchestrate` },
        );
      },
    );
    return runId;
  }

  // ── Manual trigger ────────────────────────────────────────────────
  app.post<{
    Body: { ticker?: string; company: string; thesis?: string };
  }>("/trigger", async (req, reply) => {
    const { ticker, company, thesis } = req.body ?? ({} as any);
    if (!company) return reply.code(400).send({ error: "company required" });
    const runId = await dispatchRun({
      source: "manual",
      ticker,
      company,
      thesis,
      receivedAt: Date.now(),
    });
    return { runId, statusUrl: `/runs/${runId}` };
  });

  // ── SEC EDGAR webhook ─────────────────────────────────────────────
  // Production EDGAR doesn't push directly; in practice you bridge their
  // RSS/JSON feed to a webhook via a tiny watcher. We treat *this* endpoint
  // as the webhook surface, signed via HMAC-SHA256 of the raw body.
  app.post<{
    Body: {
      ticker?: string;
      company: string;
      filingType?: string;
      filingUrl?: string;
    };
  }>("/webhooks/sec-edgar", async (req, reply) => {
    const sig = req.headers["x-veridia-signature"];
    const raw = JSON.stringify(req.body);
    const expected = createHmac("sha256", config.WEBHOOK_SHARED_SECRET)
      .update(raw)
      .digest("hex");
    if (
      typeof sig !== "string" ||
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      // For demo convenience, allow unsigned when the shared secret is the default.
      if (config.WEBHOOK_SHARED_SECRET !== "change-me") {
        return reply.code(401).send({ error: "bad signature" });
      }
    }
    const b = req.body ?? ({} as any);
    if (!b.company)
      return reply.code(400).send({ error: "company required" });
    const runId = await dispatchRun({
      source: "sec-edgar",
      ticker: b.ticker,
      company: b.company,
      filingType: b.filingType,
      filingUrl: b.filingUrl,
      receivedAt: Date.now(),
    });
    return { runId };
  });

  // ── Generic news/RSS webhook ──────────────────────────────────────
  app.post<{
    Body: { company: string; ticker?: string; thesis?: string };
  }>("/webhooks/news", async (req, reply) => {
    const b = req.body ?? ({} as any);
    if (!b.company) return reply.code(400).send({ error: "company required" });
    const runId = await dispatchRun({
      source: "news",
      ticker: b.ticker,
      company: b.company,
      thesis: b.thesis,
      receivedAt: Date.now(),
    });
    return { runId };
  });

  // ── Run status ────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    const run = await getRun(req.params.id);
    if (!run) return reply.code(404).send({ error: "not found" });
    return run;
  });

  app.get<{ Params: { id: string } }>(
    "/runs/:id/events",
    async (req) => {
      const events = await getEvents(req.params.id);
      return { events };
    },
  );

  // ── SSE live event stream for the dashboard ───────────────────────
  app.get<{ Params: { id: string } }>(
    "/runs/:id/stream",
    async (req, reply) => {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      let lastIdx = 0;
      const send = async () => {
        const events = await getEvents(req.params.id, lastIdx);
        for (const ev of events) {
          reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
        lastIdx += events.length;
      };
      const interval = setInterval(send, 800);
      req.raw.on("close", () => clearInterval(interval));
      await send();
    },
  );

  app.get("/healthz", async () => ({ ok: true, omium: true }));

  app.setErrorHandler((err, _req, reply) => {
    logger.error({ err }, "fastify error");
    const message = err instanceof Error ? err.message : String(err);
    reply.code(500).send({ error: message });
  });

  return app;
}
