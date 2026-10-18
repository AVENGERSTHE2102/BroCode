import React from "react";
import { AbsoluteFill, Composition, Series } from "remotion";
import { AskScene, EvidenceScene, InvestigationScene, SignInScene, SourcesScene } from "./footage";
import { ColdOpen, Logo, Problem } from "./intro";
import { ApprovalScene, End, GraphModelScene, Stats } from "./outro";
import { FPS, s } from "./theme";
import { Thumbnail } from "./thumbnail";

// Footage scenes last exactly as long as their clip (video/public/clips, cut by video/cut_clips.sh
// from video/raw/waypoint-recording.mp4, recorded 2026-10-18).
const SCENES: { C: React.FC; d: number }[] = [
  { C: ColdOpen, d: s(6) },
  { C: Logo, d: s(4.5) },
  { C: Problem, d: s(8) },
  { C: SignInScene, d: s(7) },       // clip 0.0-9.5s
  { C: SourcesScene, d: s(10) },     // clip 15.0-29.5s
  { C: AskScene, d: s(13) },         // clip 39.5-53.0s
  { C: InvestigationScene, d: s(12) }, // clip 239.0-251.5s
  { C: EvidenceScene, d: s(14) },    // clip 263.5-279.5s
  { C: GraphModelScene, d: s(12) },
  { C: ApprovalScene, d: s(12) },
  { C: Stats, d: s(10) },
  { C: End, d: s(9) },
];

export const TOTAL = SCENES.reduce((a, b) => a + b.d, 0);

const Main: React.FC = () => (
  <AbsoluteFill style={{ background: "#0b0d0c" }}>
    <Series>
      {SCENES.map(({ C, d }, i) => (
        <Series.Sequence key={i} durationInFrames={d}>
          <C />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);

export const Root: React.FC = () => (
  <>
    <Composition id="Waypoint" component={Main} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
    <Composition id="Thumbnail" component={Thumbnail} durationInFrames={1} fps={FPS} width={1280} height={720} />
  </>
);
