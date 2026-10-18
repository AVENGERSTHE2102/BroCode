import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { C, display, mono } from "./theme";

/** YouTube thumbnail 1280×720: two real screenshots from the 2026-10-18 live session
    (the graph trace view, 160 entities / 191 relationships; the cited-answer view). */
const Shot: React.FC<{ src: string; rotate: number; left: number; top: number; h: number; crop: number }> = ({
  src,
  rotate,
  left,
  top,
  h,
  crop,
}) => {
  const w = h * crop;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: w + 16,
        height: h + 16,
        padding: 8,
        borderRadius: 24,
        background: "#070907",
        transform: `rotate(${rotate}deg)`,
        boxShadow: "0 30px 70px rgba(0,0,0,0.6), 0 0 0 2px #262b24",
      }}
    >
      <div style={{ width: w, height: h, borderRadius: 18, overflow: "hidden" }}>
        <Img src={staticFile(src)} style={{ width: w, height: h, objectFit: "cover", objectPosition: "top" }} />
      </div>
    </div>
  );
};

export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{ background: `radial-gradient(circle at 78% 40%, #1c2a1e 0%, ${C.bg} 55%)`, overflow: "hidden" }}>
    <div style={{ position: "absolute", left: 56, top: 60, width: 620 }}>
      <div
        style={{
          display: "inline-block",
          fontFamily: mono,
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: "0.12em",
          color: C.bg,
          background: C.sage,
          padding: "8px 16px",
          borderRadius: 10,
        }}
      >
        CONNECTED-DATA AGENT
      </div>
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: 104, lineHeight: 0.92, letterSpacing: "-0.045em", color: C.text, marginTop: 26 }}>
        Clarity
      </div>
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: 104, lineHeight: 0.92, letterSpacing: "-0.045em", color: C.sage, marginTop: 6 }}>
        before
        <br />
        action.
      </div>
      <div style={{ fontFamily: display, fontWeight: 700, fontSize: 34, color: C.text, marginTop: 30 }}>
        Waypoint · graph agent, human-approved
      </div>
    </div>
    <Shot src="thumb/graph.jpg" rotate={-7} left={700} top={150} h={430} crop={0.72} />
    <Shot src="thumb/citations.jpg" rotate={6} left={940} top={60} h={460} crop={0.65} />
    <div
      style={{
        position: "absolute",
        right: 36,
        bottom: 30,
        fontFamily: display,
        fontWeight: 800,
        fontSize: 32,
        color: C.text,
        background: "rgba(11,13,12,0.85)",
        padding: "10px 20px",
        borderRadius: 14,
        border: `2px solid ${C.sage}`,
      }}
    >
      <span style={{ color: C.sage }}>●</span> Waypoint
    </div>
  </AbsoluteFill>
);
