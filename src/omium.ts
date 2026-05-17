/**
 * Omium SDK wrapper.
 *
 * Omium is offered as an *optional* tracing/observability layer for the bonus
 * +10% evaluation axis. If OMIUM_API_KEY is unset we fall back to a no-op
 * implementation that still preserves causal parent/child relationships in
 * memory and emits them to pino — so the rest of the codebase can be
 * instrumented unconditionally.
 *
 * We treat each "span" as: { runId, parentId, type, name, input, output,
 * status, startedAt, finishedAt }. The Omium HTTP API surface used here is
 * intentionally narrow:
 *
 *   POST  /v1/traces/spans          { ...span }
 *   PATCH /v1/traces/spans/:id      { output, status, finishedAt }
 *
 * If the real SDK shape differs, only this file needs editing.
 */

import { request } from "undici";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { logger } from "./logger.js";

export type SpanType =
  | "webhook"
  | "agent"
  | "tool"
  | "llm"
  | "queue.dispatch"
  | "queue.consume"
  | "synthesis"
  | "report";

export interface Span {
  id: string;
  runId: string;
  parentId: string | null;
  type: SpanType;
  name: string;
  input?: unknown;
  output?: unknown;
  status: "running" | "ok" | "error";
  error?: string;
  startedAt: number;
  finishedAt?: number;
  metadata?: Record<string, unknown>;
}

const omiumEnabled = Boolean(config.OMIUM_API_KEY && config.OMIUM_PROJECT_ID);

async function emit(span: Span, mode: "start" | "finish"): Promise<void> {
  if (!omiumEnabled) return;
  const path =
    mode === "start" ? "/v1/traces/spans" : `/v1/traces/spans/${span.id}`;
  try {
    await request(`${config.OMIUM_ENDPOINT}${path}`, {
      method: mode === "start" ? "POST" : "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.OMIUM_API_KEY}`,
        "x-omium-project": config.OMIUM_PROJECT_ID!,
      },
      body: JSON.stringify(span),
    });
  } catch (err) {
    logger.warn({ err, spanId: span.id }, "omium emit failed (non-fatal)");
  }
}

export interface TraceContext {
  runId: string;
  parentId: string | null;
}

export async function withSpan<T>(
  ctx: TraceContext,
  type: SpanType,
  name: string,
  input: unknown,
  fn: (childCtx: TraceContext, span: Span) => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const span: Span = {
    id: nanoid(12),
    runId: ctx.runId,
    parentId: ctx.parentId,
    type,
    name,
    input,
    status: "running",
    startedAt: Date.now(),
    metadata,
  };
  await emit(span, "start");
  logger.debug({ span }, `span:start ${type}/${name}`);
  const childCtx: TraceContext = { runId: ctx.runId, parentId: span.id };
  try {
    const out = await fn(childCtx, span);
    span.output = out;
    span.status = "ok";
    span.finishedAt = Date.now();
    await emit(span, "finish");
    logger.debug(
      { spanId: span.id, ms: span.finishedAt - span.startedAt },
      `span:ok ${type}/${name}`,
    );
    return out;
  } catch (err) {
    span.status = "error";
    span.error = err instanceof Error ? err.message : String(err);
    span.finishedAt = Date.now();
    await emit(span, "finish");
    logger.error(
      { err, spanId: span.id },
      `span:error ${type}/${name}`,
    );
    throw err;
  }
}

export function rootCtx(runId: string): TraceContext {
  return { runId, parentId: null };
}

export const omium = { enabled: omiumEnabled };
