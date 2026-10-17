// Adapted from React Bits ShinyText (CSS variant): https://reactbits.dev/text-animations/shiny-text
import * as React from "react";

export function ShinyText({ text, disabled = false, speed = 2.4, className = "" }: { text: string; disabled?: boolean; speed?: number; className?: string }) {
  return <span className={`shiny-text ${disabled ? "" : "is-shining"} ${className}`} style={{ "--shiny-speed": `${speed}s` } as React.CSSProperties}>{text}</span>;
}
