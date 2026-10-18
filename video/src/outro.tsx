import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";
import { Bg, Chip, Code, E, H, IllustrativeBadge, Kicker, P, Pop, Slam } from "./ui";
import { C, display, mono, s } from "./theme";

/** Illustrative: the real node/edge types (docs/graph-model.md) and a real bounded MATCH
    shape from src/lib/graph-tools.ts (traceGraphEntity), not a screen recording. */
export const GraphModelScene: React.FC = () => {
  const frame = useCurrentFrame();
  const sp = (at: number, d = 13) => spring({ frame: frame - s(at), fps: 30, config: { damping: d } });
  const NODES = [
    { n: "Repository", x: 180, y: 120 },
    { n: "Commit", x: 420, y: 60 },
    { n: "PullRequest", x: 420, y: 220 },
    { n: "File", x: 660, y: 40 },
    { n: "CheckRun", x: 660, y: 180 },
    { n: "Person", x: 420, y: 340 },
  ];
  const EDGES: [number, number, string][] = [
    [0, 1, "HAS_COMMIT"], [0, 2, "HAS_PULL_REQUEST"], [1, 3, "CHANGED_FILE"],
    [0, 4, "HAS_CHECK_RUN"], [1, 5, "AUTHORED"],
  ];
  return (
    <AbsoluteFill>
      <Bg />
      <div style={{ position: "absolute", left: 130, top: 80 }}>
        <Kicker>How it actually runs</Kicker>
        <H size={58} style={{ marginTop: 12 }}>
          FalkorDB isn't decoration. <span style={{ color: C.sage }}>It's the reasoning.</span>
        </H>
      </div>
      <div style={{ position: "absolute", left: 130, top: 260, width: 820, height: 420 }}>
        <svg width={820} height={420} style={{ position: "absolute" }}>
          {EDGES.map(([a, b, label], i) => {
            const p = sp(0.6 + i * 0.25);
            const n1 = NODES[a];
            const n2 = NODES[b];
            return (
              <g key={i} opacity={p}>
                <line x1={n1.x} y1={n1.y} x2={n2.x} y2={n2.y} stroke={C.line} strokeWidth={2} />
                <text x={(n1.x + n2.x) / 2} y={(n1.y + n2.y) / 2 - 8} fill={C.sageSoft} fontFamily={mono} fontSize={14}>
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
        {NODES.map((n, i) => {
          const p = sp(0.3 + i * 0.18, 11);
          return (
            <div
              key={n.n}
              style={{
                position: "absolute",
                left: n.x - 60,
                top: n.y - 20,
                opacity: p,
                transform: `scale(${interpolate(p, [0, 1], [0.5, 1])})`,
                padding: "10px 16px",
                borderRadius: 12,
                background: C.panel,
                border: `1.5px solid ${C.sage}`,
                fontFamily: display,
                fontWeight: 700,
                fontSize: 18,
                color: C.text,
              }}
            >
              {n.n}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 1010, top: 260, width: 780 }}>
        <Pop at={2.4}>
          <P size={22} style={{ marginBottom: 14 }}>trace_entity — bounded multi-hop MATCH, src/lib/graph-tools.ts</P>
        </Pop>
        <Code
          at={2.6}
          step={0.5}
          size={19}
          lines={[
            { t: "MATCH p=(start)-[*1..4]-(related)", c: C.text },
            { t: "WHERE (start.id = $entity_id", c: C.muted },
            { t: "    OR start.source_id = $entity_id)", c: C.muted },
            { t: "  AND length(p) <= $max_depth", c: C.muted },
            { t: "  AND all(n IN nodes(p) WHERE <acl readable>)", c: C.sageSoft },
            { t: "RETURN nodes(p), relationships(p)", c: C.text },
            { t: "LIMIT $limit", c: C.text },
          ]}
        />
      </div>
    </AbsoluteFill>
  );
};

/** Illustrative: the approval gate and draft-PR shape, matching the real schema and UI copy
    ("read-only agent, you approve every action"; proposals bind to an exact content hash,
    evidence revision, and pinned base SHA; execution creates a draft PR, never merges).
    Labeled on screen — this specific run was not captured live today. */
export const ApprovalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const sp = (at: number, d = 13) => spring({ frame: frame - s(at), fps: 30, config: { damping: d } });
  const approve = sp(2.8, 9);
  return (
    <AbsoluteFill>
      <Bg />
      <IllustrativeBadge />
      <div style={{ position: "absolute", left: 130, top: 110 }}>
        <Kicker>Nothing executes without you</Kicker>
        <H size={58} style={{ marginTop: 12 }}>
          Agents propose. <span style={{ color: C.sage }}>A human approves.</span>
        </H>
      </div>
      <div style={{ position: "absolute", left: 130, top: 300, width: 720 }}>
        <Pop at={0.4}>
          <div style={{ background: C.panel, border: `1.5px solid ${C.line}`, borderRadius: 20, padding: 30 }}>
            <Chip size={18} color={C.sageSoft}>github_patch proposal</Chip>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 24, color: C.text, marginTop: 16 }}>
              Bound to: exact content hash · evidence revision · pinned base SHA
            </div>
            <div style={{ fontFamily: mono, fontSize: 18, color: C.muted, marginTop: 14 }}>
              repo: DeepMehta06/Archlens · base: main @ 40-char SHA
            </div>
          </div>
        </Pop>
        <Pop at={1.6}>
          <div
            style={{
              marginTop: 24,
              display: "flex",
              alignItems: "center",
              gap: 16,
              opacity: approve,
            }}
          >
            <div style={{ fontFamily: display, fontWeight: 800, fontSize: 24, padding: "16px 28px", borderRadius: 14, background: C.sage, color: C.bg }}>
              Owner approves
            </div>
            <span style={{ color: C.muted, fontFamily: mono, fontSize: 28 }}>→</span>
          </div>
        </Pop>
      </div>
      <div style={{ position: "absolute", left: 980, top: 300, width: 760, opacity: sp(3.4) }}>
        <div style={{ background: "#0f120f", border: `1.5px solid ${C.sage}`, borderRadius: 20, padding: 30 }}>
          <Chip size={18} bg="#172016" color={C.sage}>draft pull request · never auto-merged</Chip>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: 28, color: C.text, marginTop: 18 }}>
            Scoped token · one repo · contents + PR write only
          </div>
          <div style={{ fontFamily: mono, fontSize: 18, color: C.muted, marginTop: 14 }}>
            short-lived credential, revoked immediately after the PR is created and verified
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const STATS = [
  { n: 18, label: "authenticated MCP tools, discovered by the official SDK", suffix: "" },
  { n: 27, label: "offline contract tests — bun run test:contracts, all passing today", suffix: "" },
  { n: 18, label: "state-changing routes with same-origin / CSRF checks", suffix: "" },
  { n: 1, label: "real GitHub repository connected and synced today", suffix: "" },
];

export const Stats: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Bg />
      <div style={{ position: "absolute", left: 150, top: 110 }}>
        <Kicker>Verified, not claimed</Kicker>
        <H size={60} style={{ marginTop: 12 }}>Numbers pulled from the terminal today.</H>
      </div>
      <div style={{ position: "absolute", left: 150, top: 330, display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 90, rowGap: 46, width: 1620 }}>
        {STATS.map((st, i) => {
          const p = spring({ frame: frame - s(0.5 + i * 0.5), fps: 30, config: { damping: 12 } });
          const val = Math.round(interpolate(p, [0, 1], [0, st.n]));
          return (
            <div key={st.label} style={{ display: "flex", alignItems: "baseline", gap: 26, opacity: Math.min(1, p * 1.5) }}>
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: 100, color: C.sage, minWidth: 180, letterSpacing: "-0.04em" }}>{val}</div>
              <div style={{ fontFamily: display, fontSize: 28, color: C.muted, maxWidth: 560 }}>{st.label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 150, bottom: 90, display: "flex", gap: 16, flexWrap: "wrap", width: 1620 }}>
        {["Real GRAPH.QUERY round-trips (local FalkorDB)", "Human approval gate on every write", "Quarantined agent memory until reviewed", "Draft PRs only — never auto-merged"].map((t, i) => (
          <Pop key={t} at={3.2 + i * 0.3}>
            <Chip size={22}>{t}</Chip>
          </Pop>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const End: React.FC = () => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [s(7.5), s(9)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Bg />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 20 }}>
        <Slam at={0.2} size={140}>Less context switching.</Slam>
        <Slam at={0.8} size={140} color={C.sage}>More forward.</Slam>
        <Pop at={2.0}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 40 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: C.sage }} />
            <div style={{ fontFamily: display, fontWeight: 800, fontSize: 60, color: C.text }}>Waypoint</div>
          </div>
        </Pop>
        <Pop at={2.6}>
          <P size={30} style={{ color: C.text, textAlign: "center" }}>
            Agents That Act on Connected Data · Company Brain · Agent Memory and Coordination
          </P>
        </Pop>
        <Pop at={3.1}>
          <div style={{ fontFamily: mono, fontSize: 28, color: C.sageSoft, marginTop: 8 }}>github.com/AVENGERSTHE2102/BroCode</div>
        </Pop>
        <Pop at={3.6}>
          <div style={{ fontFamily: mono, fontSize: 20, color: C.muted, marginTop: 4 }}>
            <E>🤖</E> Built with AI-assisted development — disclosed per hackathon rule 11
          </div>
        </Pop>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
