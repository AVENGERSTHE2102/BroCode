"use client";
// Adapted from React Bits FadeContent (reactbits.dev/r/FadeContent-TS-CSS.json).
// Retains the GSAP scroll reveal, reduced-motion handling, and context cleanup.
import { useEffect, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
export function FadeContent({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      gsap.fromTo(ref.current, { opacity: .3, y: 14 }, { opacity: 1, y: 0, duration: .8, ease: "power2.out", scrollTrigger: { trigger: ref.current, start: "top 95%", once: true }, clearProps: "transform,opacity" });
    }, ref);
    return () => ctx.revert();
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}
