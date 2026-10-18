import React from "react";
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Bg, Chip, H, Kicker, P, Pop, Slam } from "./ui";
import { C, display, mono, s } from "./theme";

const SCATTER = [
  "which repo owns this?", "ask #eng-oncall", "check the old ADR", "who touched this last quarter?",
  "it's in someone's head", "see the postmortem doc", "grep the monorepo", "ask the on-call again",
  "was this ever decided?", "check three tools, still no answer", "tribal knowledge only", "it's somewhere in Slack",
  "ticket says 'see PR'", "PR says 'see ticket'", "nobody remembers why",
];

/** 0–6 s: engineering context, scattered across tabs. */
export const ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const freeze = s(3.6);
  const f = Math.min(frame, freeze);
  const dim = interpolate(frame, [freeze, freeze + 10], [1, 0.18], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Bg />
      <AbsoluteFill style={{ opacity: dim }}>
        {Array.from({ length: 48 }).map((_, i) => {
          const born = i * 2.1;
          if (f < born) return null;
          const left = random(`l${i}`) > 0.5;
          const x = left ? 60 + random(`x${i}`) * 650 : 1180 + random(`x${i}`) * 620;
          const y = 1080 - (f - born) * 8 - random(`y${i}`) * 80;
          const text = SCATTER[i % SCATTER.length];
          const p = Math.min(1, (f - born) / 5);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x,
                top: y,
                transform: `scale(${0.6 + p * 0.4})`,
                opacity: p,
                fontFamily: mono,
                fontSize: 26 + random(`s${i}`) * 10,
                fontWeight: 600,
                color: left ? C.text : "#fff",
                background: left ? "#1b201a" : C.sageDeep,
                padding: "12px 20px",
                borderRadius: 12,
                whiteSpace: "nowrap",
                border: `1px solid ${C.line}`,
              }}
            >
              {text}
            </div>
          );
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 10 }}>
        <Slam at={3.7} size={128}>Context, scattered.</Slam>
        <Slam at={4.4} size={128} color={C.sage}>Answers, nowhere.</Slam>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** 6–10.5 s: the scatter collapses into the Waypoint mark. */
export const Logo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dot = spring({ frame, fps, config: { damping: 9, stiffness: 120 } });
  const grow = spring({ frame: frame - 14, fps, config: { damping: 14 } });
  const size = interpolate(dot, [0, 1], [900, 46]);
  const letters = "Waypoint".split("");
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Bg />
      <div
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: "50%",
          background: C.sage,
          opacity: interpolate(grow, [0, 1], [1, 0]),
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <div style={{ width: 70 * grow, height: 70 * grow, borderRadius: 18, background: C.sage }} />
        <div style={{ display: "flex" }}>
          {letters.map((ch, i) => {
            const p = spring({ frame: frame - 16 - i * 2, fps, config: { damping: 12 } });
            return (
              <span
                key={i}
                style={{
                  fontFamily: display,
                  fontWeight: 800,
                  fontSize: 150,
                  letterSpacing: "-0.04em",
                  color: C.text,
                  whiteSpace: "pre",
                  opacity: p,
                  transform: `translateY(${interpolate(p, [0, 1], [80, 0])}px)`,
                  display: "inline-block",
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>
      </div>
      <div style={{ position: "absolute", top: 650 }}>
        <Pop at={1.4}>
          <P size={36} style={{ color: C.text, textAlign: "center" }}>
            Connected intelligence, <b style={{ color: C.sage }}>considered.</b>
          </P>
        </Pop>
      </div>
    </AbsoluteFill>
  );
};

/** 10.5–18.5 s: Waypoint's own framing — not a chatbot, a graph the agent walks. */
export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const sp = (at: number, d = 13) => spring({ frame: frame - s(at), fps: 30, config: { damping: d } });
  const TRACKS = [
    { label: "Acts on connected data", tag: "trace_entity → propose_action" },
    { label: "Remembers & coordinates", tag: "recall_attempts → claim_task" },
    { label: "Company brain", tag: "resolve_entity → cited answers" },
  ];
  return (
    <AbsoluteFill>
      <Bg />
      <div style={{ position: "absolute", left: 130, top: 130, width: 1660 }}>
        <Kicker>Waypoint</Kicker>
        <H size={70} style={{ marginTop: 14 }}>
          Not a chatbot. <span style={{ color: C.sage }}>A graph the agent can walk.</span>
        </H>
        <Pop at={0.5}>
          <P size={32} style={{ marginTop: 26, maxWidth: 1300 }}>
            Every answer is a path through connected evidence — the entities and relationships the agent
            actually followed, so you can trace each decision back to its source.
          </P>
        </Pop>
      </div>
      <div style={{ position: "absolute", left: 130, top: 500, display: "flex", gap: 36 }}>
        {TRACKS.map((t, i) => {
          const p = sp(1.1 + i * 0.3);
          return (
            <div
              key={t.label}
              style={{
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [40, 0])}px)`,
                width: 480,
                padding: "34px 32px",
                borderRadius: 22,
                background: C.panel,
                border: `1.5px solid ${C.line}`,
              }}
            >
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: 32, color: C.text }}>{t.label}</div>
              <Chip style={{ marginTop: 22 }} size={20} color={C.sageSoft}>{t.tag}</Chip>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 130, bottom: 90 }}>
        <Pop at={2.4}>
          <P size={30}>Connect a source. Ask a question. <span style={{ color: C.text }}>Follow the thread.</span></P>
        </Pop>
      </div>
    </AbsoluteFill>
  );
};
