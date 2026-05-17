/**
 * React-PDF memo template. Renders the synthesis output as a polished,
 * 4–6 page investment memo. Pure component; the worker calls
 * `renderToBuffer` on it.
 */

import React from "react";
import {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
  Link,
} from "@react-pdf/renderer";
import type { SynthesisResult } from "../agents/synthesis.js";

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 10.5,
    fontFamily: "Helvetica",
    color: "#0f172a",
    lineHeight: 1.45,
  },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "#0f172a",
    paddingBottom: 8,
    marginBottom: 18,
  },
  brand: { fontSize: 14, fontWeight: 700, letterSpacing: 2 },
  brandMeta: { fontSize: 9, color: "#475569" },
  title: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 11, color: "#475569", marginBottom: 22 },
  verdictBox: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#0f172a",
    padding: 12,
    marginBottom: 18,
  },
  verdictCell: { flex: 1, paddingRight: 12 },
  verdictLabel: {
    fontSize: 8,
    letterSpacing: 1.5,
    color: "#64748b",
    marginBottom: 2,
  },
  verdictValue: { fontSize: 14, fontWeight: 700 },
  h2: {
    fontSize: 12,
    fontWeight: 700,
    marginTop: 14,
    marginBottom: 6,
    color: "#0f172a",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 3,
  },
  p: { marginBottom: 6 },
  bullet: { flexDirection: "row", marginBottom: 3 },
  bulletDot: { width: 12 },
  contradictionBox: {
    borderLeftWidth: 3,
    borderLeftColor: "#dc2626",
    paddingLeft: 8,
    marginBottom: 6,
    backgroundColor: "#fef2f2",
    padding: 6,
  },
  evidenceRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 4,
  },
  evidenceClaim: { flex: 3, paddingRight: 6 },
  evidenceAgent: { flex: 1, color: "#64748b", fontSize: 9 },
  evidenceSource: { flex: 2, fontSize: 9, color: "#2563eb" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#94a3b8",
    borderTopWidth: 0.5,
    borderTopColor: "#e2e8f0",
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

interface MemoProps {
  runId: string;
  company: string;
  ticker?: string;
  generatedAt: string;
  synthesis: SynthesisResult;
  trigger: { source: string; thesis?: string };
  agents: Record<string, unknown>;
}

function Bullets({ items }: { items: string[] }) {
  if (!items.length)
    return <Text style={{ color: "#94a3b8" }}>None reported.</Text>;
  return (
    <View>
      {items.map((b, i) => (
        <View key={i} style={styles.bullet}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={{ flex: 1 }}>{b}</Text>
        </View>
      ))}
    </View>
  );
}

export function Memo(props: MemoProps) {
  const { synthesis: s, agents } = props;
  const financial = (agents.financial ?? {}) as Record<string, unknown>;
  const market = (agents.market ?? {}) as Record<string, unknown>;
  const tech = (agents.tech ?? {}) as Record<string, unknown>;
  const team = (agents.team ?? {}) as Record<string, unknown>;
  const risk = (agents.risk ?? {}) as Record<string, unknown>;

  return (
    <Document title={`Veridia Memo · ${props.company}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>VERIDIA</Text>
          <Text style={styles.brandMeta}>
            Autonomous Diligence · {props.generatedAt}
          </Text>
        </View>

        <Text style={styles.title}>
          {props.company}
          {props.ticker ? `  (${props.ticker})` : ""}
        </Text>
        <Text style={styles.subtitle}>
          Triggered by: {props.trigger.source}
          {props.trigger.thesis ? ` · Thesis: ${props.trigger.thesis}` : ""}
        </Text>

        <View style={styles.verdictBox}>
          <View style={styles.verdictCell}>
            <Text style={styles.verdictLabel}>VERDICT</Text>
            <Text style={styles.verdictValue}>{s.verdict}</Text>
          </View>
          <View style={styles.verdictCell}>
            <Text style={styles.verdictLabel}>CONVICTION</Text>
            <Text style={styles.verdictValue}>
              {(s.conviction * 100).toFixed(0)}%
            </Text>
          </View>
          <View style={{ ...styles.verdictCell, flex: 2 }}>
            <Text style={styles.verdictLabel}>HEADLINE</Text>
            <Text style={{ fontSize: 10 }}>{s.headline}</Text>
          </View>
        </View>

        <Text style={styles.h2}>Investment Thesis</Text>
        <Text style={styles.p}>{s.thesis}</Text>

        <Text style={styles.h2}>Key Drivers</Text>
        <Bullets items={s.keyDrivers} />

        <Text style={styles.h2}>Key Risks</Text>
        <Bullets items={s.keyRisks} />

        {s.contradictions.length > 0 && (
          <>
            <Text style={styles.h2}>Cross-Agent Contradictions</Text>
            {s.contradictions.map((c, i) => (
              <View key={i} style={styles.contradictionBox}>
                <Text style={{ fontWeight: 700, fontSize: 9 }}>
                  {c.between.join(" ↔ ")}
                </Text>
                <Text>{c.note}</Text>
              </View>
            ))}
          </>
        )}

        <Text style={styles.footer} fixed>
          <Text>Veridia · run {props.runId}</Text>
        </Text>
      </Page>

      <Page size="A4" style={styles.page}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>VERIDIA</Text>
          <Text style={styles.brandMeta}>Diligence Detail</Text>
        </View>

        <Text style={styles.h2}>Market</Text>
        <Text style={styles.p}>
          Size: {String(market.marketSize ?? "—")} · Growth:{" "}
          {String(market.growthRate ?? "—")}
        </Text>
        {Array.isArray(market.competitors) && (
          <>
            <Text style={{ fontWeight: 700, marginTop: 4 }}>Competitors</Text>
            <Bullets
              items={(market.competitors as Array<{ name: string; differentiator: string }>).map(
                (c) => `${c.name} — ${c.differentiator}`,
              )}
            />
          </>
        )}

        <Text style={styles.h2}>Financial</Text>
        <Text style={styles.p}>
          {String(financial.narrative ?? "No financial narrative available.")}
        </Text>
        {Array.isArray(financial.recentFilings) && financial.recentFilings.length > 0 && (
          <>
            <Text style={{ fontWeight: 700, marginTop: 4 }}>Recent Filings</Text>
            <Bullets
              items={(financial.recentFilings as Array<{ form: string; date: string; url: string }>)
                .slice(0, 6)
                .map((f) => `${f.form} · ${f.date} — ${f.url}`)}
            />
          </>
        )}

        <Text style={styles.h2}>Technology</Text>
        <Text style={styles.p}>
          {String(tech.narrative ?? "No technology signal available.")}
        </Text>

        <Text style={styles.h2}>Team</Text>
        <Text style={styles.p}>
          {String(team.narrative ?? "No team profile available.")}
        </Text>

        <Text style={styles.h2}>Risk</Text>
        <Text style={styles.p}>
          {String(risk.narrative ?? "No risk findings.")}
        </Text>

        <Text style={styles.footer} fixed>
          <Text>Veridia · run {props.runId}</Text>
        </Text>
      </Page>

      <Page size="A4" style={styles.page}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>VERIDIA</Text>
          <Text style={styles.brandMeta}>Evidence Ledger</Text>
        </View>

        <Text style={styles.h2}>Evidence Table</Text>
        <View style={{ ...styles.evidenceRow, fontWeight: 700 }}>
          <Text style={styles.evidenceClaim}>Claim</Text>
          <Text style={styles.evidenceAgent}>Agent</Text>
          <Text style={styles.evidenceSource}>Source</Text>
        </View>
        {s.evidenceTable.slice(0, 40).map((e, i) => (
          <View key={i} style={styles.evidenceRow}>
            <Text style={styles.evidenceClaim}>{e.claim}</Text>
            <Text style={styles.evidenceAgent}>{e.agent}</Text>
            <Link src={e.source} style={styles.evidenceSource}>
              {e.source.slice(0, 60)}
            </Link>
          </View>
        ))}

        {s.openQuestions.length > 0 && (
          <>
            <Text style={styles.h2}>Open Questions</Text>
            <Bullets items={s.openQuestions} />
          </>
        )}

        <Text style={styles.footer} fixed>
          <Text>
            Generated autonomously by Veridia. No human edited this document.
          </Text>
        </Text>
      </Page>
    </Document>
  );
}
