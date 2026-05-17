/**
 * Renders the React-PDF Memo to a file on disk under ./reports/<runId>.pdf.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { Memo } from "./render.js";
import type { SynthesisResult } from "../agents/synthesis.js";
import type { RunTrigger } from "../state/store.js";

export interface GenerateMemoArgs {
  runId: string;
  trigger: RunTrigger;
  synthesis: SynthesisResult;
  agents: Record<string, unknown>;
}

export async function generateMemoPdf(args: GenerateMemoArgs): Promise<string> {
  const outDir = path.resolve(process.cwd(), "reports");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${args.runId}.pdf`);
  // The Memo component returns a <Document>; renderToBuffer types want the
  // DocumentProps element, but at runtime it accepts any element rendering
  // to a Document. Cast through unknown.
  const element = React.createElement(Memo, {
    runId: args.runId,
    company: args.trigger.company,
    ticker: args.trigger.ticker,
    generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    synthesis: args.synthesis,
    trigger: { source: args.trigger.source, thesis: args.trigger.thesis },
    agents: args.agents,
  });
  const buffer = await renderToBuffer(
    element as unknown as Parameters<typeof renderToBuffer>[0],
  );
  await writeFile(outPath, buffer);
  return outPath;
}
