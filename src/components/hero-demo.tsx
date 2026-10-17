"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, GitBranch, GitPullRequest, Layers, Fingerprint } from "lucide-react";

const QUESTION = "What changed before checkout started failing?";
const STEPS = [
  { icon: GitBranch, text: "Searching recent changes in checkout.ts" },
  { icon: Layers, text: "Recalling a past attempt: retry backoff" },
  { icon: Fingerprint, text: "Linking PR #142 to the failing calls" },
];

// Illustrative looping preview of the product flow (typed question → evidence steps → cited answer → human approval).
export function HeroDemo() {
  const [typed, setTyped] = useState(0);
  const [steps, setSteps] = useState(0);
  const [answer, setAnswer] = useState(false);
  const [approval, setApproval] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(QUESTION.length); setSteps(STEPS.length); setAnswer(true); setApproval(true);
      return;
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms));
    const cycle = () => {
      setTyped(0); setSteps(0); setAnswer(false); setApproval(false);
      let t = 700;
      for (let i = 1; i <= QUESTION.length; i++) { t += 32; at(t, () => setTyped(i)); }
      t += 500;
      for (let i = 1; i <= STEPS.length; i++) { t += 750; at(t, () => setSteps(i)); }
      t += 700; at(t, () => setAnswer(true));
      t += 1000; at(t, () => setApproval(true));
      t += 4800; at(t, cycle);
    };
    cycle();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, []);

  function onMove(event: React.PointerEvent<HTMLDivElement>) {
    const el = wrap.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--rx", `${((event.clientY - rect.top) / rect.height - 0.5) * -6}deg`);
    el.style.setProperty("--ry", `${((event.clientX - rect.left) / rect.width - 0.5) * 8}deg`);
  }
  function onLeave() { wrap.current?.style.setProperty("--rx", "0deg"); wrap.current?.style.setProperty("--ry", "0deg"); }

  return (
    <div className="hero-stage" ref={wrap} onPointerMove={onMove} onPointerLeave={onLeave} aria-label="Illustrative preview: a question turns into cited evidence and a proposal awaiting human approval" role="img">
      <div className="stage-glow" />
      <svg className="stage-lines" viewBox="0 0 560 520" aria-hidden="true">
        <path d="M40 120 C120 120 120 200 200 215" /><path d="M520 110 C450 120 440 190 380 215" /><path d="M30 440 C120 440 130 350 210 320" /><path d="M530 430 C450 430 440 350 370 320" />
        <circle className="pulse p1" r="3.5" opacity="0"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.08;.92;1" dur="4s" repeatCount="indefinite" /><animateMotion dur="4s" repeatCount="indefinite" path="M40 120 C120 120 120 200 200 215" /></circle>
        <circle className="pulse p2" r="3.5" opacity="0"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.08;.92;1" dur="5s" begin="1s" repeatCount="indefinite" /><animateMotion dur="5s" begin="1s" repeatCount="indefinite" path="M520 110 C450 120 440 190 380 215" /></circle>
        <circle className="pulse p3" r="3.5" opacity="0"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.08;.92;1" dur="4.5s" begin="2s" repeatCount="indefinite" /><animateMotion dur="4.5s" begin="2s" repeatCount="indefinite" path="M30 440 C120 440 130 350 210 320" /></circle>
        <circle className="pulse p4" r="3.5" opacity="0"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.08;.92;1" dur="5.5s" begin=".5s" repeatCount="indefinite" /><animateMotion dur="5.5s" begin=".5s" repeatCount="indefinite" path="M530 430 C450 430 440 350 370 320" /></circle>
      </svg>
      <span className="float-chip fc-a"><GitBranch size={13} /> checkout.ts</span>
      <span className="float-chip fc-b"><Layers size={13} /> Past attempt</span>
      <span className="float-chip fc-c"><Fingerprint size={13} /> PR #142</span>
      <span className="float-chip fc-d"><Check size={13} /> Reviewed</span>
      <div className="demo-window">
        <div className="demo-bar"><i /><i /><i /><span>Ask Waypoint</span></div>
        <div className="demo-body">
          <div className="demo-user"><p>{QUESTION.slice(0, typed)}{typed < QUESTION.length && <span className="caret" />}</p></div>
          <ol className="demo-steps">
            {STEPS.slice(0, steps).map((step) => <li key={step.text}><step.icon size={13} />{step.text}<Check size={13} className="done" /></li>)}
            {steps > 0 && !answer && <li className="working"><span className="dots"><b /><b /><b /></span>Reasoning over evidence</li>}
          </ol>
          {answer && <div className="demo-answer">
            <p>A missing timeout guard in the retry change connects PR #142 to the failures. Uncertainty: one affected service has no trace.</p>
            <div className="demo-cites"><span>checkout.ts · a41f9c</span><span>PR #142</span></div>
          </div>}
          {approval && <div className="demo-approval"><GitPullRequest size={16} /><div><strong>Draft pull request proposed</strong><small>Waiting for your approval</small></div><span className="approve-btn">Approve</span></div>}
        </div>
        <div className="demo-composer"><span>Follow the evidence…</span><b><ArrowUp size={14} /></b></div>
      </div>
    </div>
  );
}
