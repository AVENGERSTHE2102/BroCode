import React from "react";
import { interpolate, spring, useCurrentFrame } from "remotion";
import { Chip, E, Footage, H, Kicker, P, Pop } from "./ui";
import { C, display, mono, s } from "./theme";

/* Clip times below are seconds inside each sped-up clip — see video/README.md for the
   source-recording mapping and video/cut_clips.sh for the cuts. Every line here was verified
   against the running app on 2026-10-18 (local FalkorDB via Docker, live Supabase session,
   the real GitHub App connection to DeepMehta06/Archlens). */

export const SignInScene: React.FC = () => (
  <Footage clip="clips/c1_signin.mp4" tag="SIGN IN · COCKPIT" step={0}>
    <Kicker>Real workspace · real session</Kicker>
    <H size={64} style={{ marginTop: 16 }}>
      One workspace.
      <br />
      <span style={{ color: C.sage }}>Scoped to you.</span>
    </H>
    <div style={{ marginTop: 44, display: "flex", flexDirection: "column", gap: 20, alignItems: "flex-start" }}>
      <Pop at={1.0} from="left"><Chip><E>🔐</E> Supabase-authenticated session · owner role</Chip></Pop>
      <Pop at={3.0} from="left"><Chip><E>●</E> Graph connected — FalkorDB, one graph per workspace</Chip></Pop>
      <Pop at={5.2} from="left">
        <Chip color={C.bg} bg={C.sage} style={{ border: "none" }}>
          <E>🛡</E> Read-only agent · you approve every action
        </Chip>
      </Pop>
    </div>
  </Footage>
);

export const SourcesScene: React.FC = () => (
  <Footage clip="clips/c2_sources.mp4" tag="SOURCES · GITHUB" step={1}>
    <Kicker>Codebase and security source</Kicker>
    <H size={64} style={{ marginTop: 16 }}>
      A real repo,
      <br />
      <span style={{ color: C.sage }}>actually connected.</span>
    </H>
    <div style={{ marginTop: 44, display: "flex", flexDirection: "column", gap: 20, alignItems: "flex-start" }}>
      <Pop at={1.0} from="left"><Chip><E>🔗</E> DeepMehta06/Archlens · default branch main</Chip></Pop>
      <Pop at={3.2} from="left"><Chip><E>🔄</E> Synced today via the GitHub App — read-only, least-privilege</Chip></Pop>
      <Pop at={5.6} from="left">
        <Chip color={C.amber} bg="#201c12">
          <E>⚠</E> Dependabot alerts not imported — missing permission is reported, not hidden
        </Chip>
      </Pop>
    </div>
  </Footage>
);

export const AskScene: React.FC = () => {
  const frame = useCurrentFrame();
  const sp = (at: number, d = 13) => spring({ frame: frame - s(at), fps: 30, config: { damping: d } });
  return (
    <Footage clip="clips/c3_ask.mp4" tag="ASK · GRAPH TRAVERSAL" step={2}>
      <Kicker>Connected-data agent</Kicker>
      <H size={60} style={{ marginTop: 16 }}>
        The agent <span style={{ color: C.sage }}>walks the graph.</span>
      </H>
      <P size={27} style={{ marginTop: 18 }}>"What has DeepMehta06 worked on, and how is it connected?"</P>
      <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 16 }}>
        {[
          { at: 1.6, t: "Tool: resolve_entity", sub: "resolves the exact identity first" },
          { at: 3.4, t: "Tool: trace_entity", sub: "bounded multi-hop MATCH, real GRAPH.QUERY" },
          { at: 5.2, t: "Graph path · 11 entities, 10 hops", sub: "lights up live on the knowledge graph" },
        ].map((row) => {
          const p = sp(row.at);
          return (
            <div
              key={row.t}
              style={{
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [-40, 0])}px)`,
                display: "flex",
                alignItems: "center",
                gap: 16,
                fontFamily: mono,
                fontSize: 24,
                color: C.text,
                padding: "16px 20px",
                borderRadius: 14,
                background: C.panel,
                border: `1.5px solid ${C.line}`,
              }}
            >
              <span style={{ color: C.sage }}>▸</span> {row.t}
              <span style={{ color: C.muted, fontFamily: display, fontSize: 19, marginLeft: 4 }}>{row.sub}</span>
            </div>
          );
        })}
      </div>
    </Footage>
  );
};

export const InvestigationScene: React.FC = () => (
  <Footage clip="clips/c4_investigation.mp4" tag="INVESTIGATION · RECOVERY" step={3}>
    <Kicker>Durable, not disposable</Kicker>
    <H size={60} style={{ marginTop: 16 }}>
      Every question becomes
      <br />
      <span style={{ color: C.sage }}>a saved investigation.</span>
    </H>
    <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 18, alignItems: "flex-start" }}>
      <Pop at={1.0} from="left"><Chip><E>📄</E> Stored evidence, current facts, prior attempts, proposals</Chip></Pop>
      <Pop at={3.0} from="left"><Chip><E>💾</E> Recovery export — Markdown or JSON, resumes in a new session</Chip></Pop>
      <Pop at={5.0} from="left"><Chip><E>🤝</E> Tasks and handoffs — leased ownership, no silent overwrite</Chip></Pop>
    </div>
  </Footage>
);

/* This scene's clip is the raw trace log, not a polished chat answer — two live agent
   runs hit a provider rate limit during recording, so the finished "cited answer" view
   isn't in the footage. What's shown instead is just as real: the actual tool_call JSON
   a successful run wrote, with real GitHub source IDs, URLs, and evidence IDs. */
export const EvidenceScene: React.FC = () => (
  <Footage clip="clips/c5_evidence.mp4" tag="RUN TRACE · RAW EVIDENCE" step={4}>
    <Kicker>Every claim, traceable</Kicker>
    <H size={58} style={{ marginTop: 16 }}>
      Not a summary. <span style={{ color: C.sage }}>The actual trace.</span>
    </H>
    <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 18, alignItems: "flex-start" }}>
      <Pop at={1.0} from="left"><Chip size={24}>tool_call: resolve_entity → real GitHub source IDs and URLs</Chip></Pop>
      <Pop at={3.2} from="left"><Chip size={24}>Every result carries an evidenceId a citation must match</Chip></Pop>
      <Pop at={5.4} from="left"><Chip size={22} color={C.amber} bg="#201c12">Two live runs hit a provider rate limit while recording this — the trace below is real, the failure is too</Chip></Pop>
    </div>
  </Footage>
);
